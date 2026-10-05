<template>
  <section class="page" data-module="pumprun">
    <header class="page-head">
      <div>
        <h2>泵组运行管理</h2>
        <p class="page-desc">
          开机规矩：状态只能从待开机顺走到运行中、再到停机，跳着改会被打回；同一台泵运行中不许开第二条；运行电流超过额定值标红并挡住确认；停机自动算时长并往检修待修清单落待办。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记运行记录</button>
        <button class="btn" type="button" @click="exportRows">导出运行清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card" :class="{ alert: item.alert }">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item" :class="`legend-${item.status}`">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-rule">状态只能顺走：待开机 → 运行中 → 已停机／故障停机</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>运行编号</span>
        <input v-model="filters['运行编号']" placeholder="按运行编号查，如 YX-0001" />
      </label>
      <label class="filter-item">
        <span>所属泵站</span>
        <select v-model="filters['所属泵站']">
          <option value="">全部泵站</option>
          <option v-for="station in stations" :key="station" :value="station">{{ station }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>泵组编号</span>
        <input v-model="filters['泵组编号']" placeholder="按泵组编号查，如 PUMP-101" />
      </label>
      <button class="btn" type="submit">三格联合查询</button>
      <button class="btn ghost" type="button" @click="locateRow">三格定位核对</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="lookupTip" class="lookup-tip" :class="{ 'tip-error': lookupError }">{{ lookupTip }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>超标提示</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-overrun': isOverrun(row), 'row-fault': row.status === '故障停机' }">
          <td>{{ row['运行编号'] }}</td>
          <td>{{ row['所属泵站'] }}</td>
          <td>{{ row['泵组编号'] }}</td>
          <td>{{ row['泵组名称'] ?? '—' }}</td>
          <td :class="{ 'cell-over': isOverrun(row) }">{{ row['运行电流(A)'] }}</td>
          <td>{{ row['额定电流(A)'] ?? '—' }}</td>
          <td>{{ row['出水流量(m³/h)'] || '—' }}</td>
          <td>{{ row['值班人'] || '—' }}</td>
          <td>{{ displayTime(row['记录时间']) }}</td>
          <td>{{ displayTime(row['开机时间']) }}</td>
          <td>{{ displayTime(row['停机时间']) }}</td>
          <td>{{ durationOf(row) }}</td>
          <td class="cell-conclusion">{{ row['停机结论'] || '—' }}</td>
          <td>
            <span class="status-badge" :class="`status-${row.status}`">{{ row.status }}</span>
          </td>
          <td class="cell-over-tip">
            <template v-if="isOverrun(row)">
              超额定值 {{ overInfo(row)?.over }}A（{{ overInfo(row)?.percent }}%），挡住开机
            </template>
            <template v-else>—</template>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action.name"
              class="link"
              :class="{ danger: action.fault }"
              type="button"
              @click="openAction(action.name, row)"
            >
              {{ action.name }}
            </button>
            <span v-if="actionsFor(row).length === 0" class="muted-text">无</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无泵组运行数据，可先登记一条运行记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条泵组运行记录 · 数据保存在本机浏览器</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记 / 开机 / 停机 / 改记电流 共用弹窗 -->
    <div v-if="dialog.open" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3 class="modal-title">{{ dialog.title }}</h3>

        <!-- 登记运行记录 -->
        <div v-if="dialog.mode === 'create'" class="modal-body">
          <label class="form-item">
            <span>运行编号</span>
            <input v-model="form.code" :placeholder="`留空自动取 ${suggestRunCode()}`" />
          </label>
          <label class="form-item">
            <span>所属泵站</span>
            <select v-model="form.station" @change="onStationChange">
              <option value="" disabled>请选择泵站</option>
              <option v-for="station in stations" :key="station" :value="station">{{ station }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>泵组编号</span>
            <select v-model="form.pumpCode" @change="onPumpChange">
              <option value="" disabled>请选择泵组</option>
              <option v-for="unit in unitsByStation" :key="unit.pumpCode" :value="unit.pumpCode">
                {{ unit.pumpCode }}（{{ unit.pumpName }}，额定 {{ unit.ratedCurrent }}A）
              </option>
            </select>
          </label>
          <label class="form-item">
            <span>泵组名称</span>
            <input :value="selectedUnit?.pumpName ?? ''" readonly placeholder="按台账自动带出" />
          </label>
          <label class="form-item">
            <span>运行电流(A)</span>
            <input v-model.number="form.current" type="number" min="0" step="0.1" />
            <small v-if="selectedUnit" :class="formOverrun ? 'over-text' : 'muted-text'">
              额定值 {{ selectedUnit.ratedCurrent }}A，
              <template v-if="formOverrun">
                当前超出 {{ overPreview }}A，登记后会标红并挡住开机
              </template>
              <template v-else>在额定值以内</template>
            </small>
          </label>
          <label class="form-item">
            <span>出水流量(m³/h)</span>
            <input v-model="form.flow" type="number" min="0" step="1" placeholder="待开机可先填 0" />
          </label>
          <label class="form-item">
            <span>值班人</span>
            <input v-model="form.operator" />
          </label>
          <label class="form-item">
            <span>记录时间</span>
            <input v-model="form.recordTime" type="datetime-local" />
          </label>
        </div>

        <!-- 提交开机 -->
        <div v-else-if="dialog.mode === 'start'" class="modal-body">
          <p class="modal-line">运行单 <strong>{{ activeRow?.['运行编号'] }}</strong>（{{ activeRow?.['所属泵站'] }} / {{ activeRow?.['泵组编号'] }}）确认开机。</p>
          <p class="modal-line muted-text">当前电流 {{ activeRow?.['运行电流(A)'] }}A，额定 {{ activeRow?.['额定电流(A)'] }}A。</p>
          <label class="form-item">
            <span>开机时间</span>
            <input v-model="form.startTime" type="datetime-local" />
          </label>
        </div>

        <!-- 登记停机 / 上报故障 -->
        <div v-else-if="dialog.mode === 'stop'" class="modal-body">
          <p class="modal-line">
            运行单 <strong>{{ activeRow?.['运行编号'] }}</strong> 开机于 {{ displayTime(activeRow?.['开机时间']) }}，
            停机时长将按两个时刻实际差值累计（跨零点照算）。
          </p>
          <label class="form-item">
            <span>{{ dialog.fault ? '故障停机时间' : '停机时间' }}</span>
            <input v-model="form.stopTime" type="datetime-local" />
          </label>
          <label class="form-item">
            <span>停机结论{{ dialog.fault ? '（故障现象）' : '' }}</span>
            <textarea v-model="form.conclusion" rows="3" placeholder="结论会落到泵组检修的待修清单，生成一条待开工待办"></textarea>
          </label>
        </div>

        <!-- 改记电流 -->
        <div v-else-if="dialog.mode === 'current'" class="modal-body">
          <p class="modal-line">
            运行单 <strong>{{ activeRow?.['运行编号'] }}</strong> 电流超标，挡住开机。请核实表计读数后改记（该泵额定 {{ activeRow?.['额定电流(A)'] }}A）。
          </p>
          <label class="form-item">
            <span>运行电流(A)</span>
            <input v-model.number="form.current" type="number" min="0" step="0.1" />
          </label>
        </div>

        <p v-if="dialog.error" class="error-text dialog-error">{{ dialog.error }}</p>

        <div class="modal-actions">
          <button class="btn" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitDialog">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  createRun,
  currentInfo,
  displayTime,
  findUnit,
  formatDuration,
  listPumpUnits,
  lookupRun,
  nowText,
  runStats,
  startRun,
  stopRun,
  suggestRunCode,
  updateRunCurrent,
} from '@/api/pump-run-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pumprun')
const columns = [
  '运行编号',
  '所属泵站',
  '泵组编号',
  '泵组名称',
  '运行电流(A)',
  '额定电流(A)',
  '出水流量(m³/h)',
  '值班人',
  '记录时间',
  '开机时间',
  '停机时间',
  '运行时长',
  '停机结论',
]

const pumpUnits = listPumpUnits()
const stations = [...new Set(pumpUnits.map((unit) => unit.station))]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const lookupTip = ref('')
const lookupError = ref(false)
const filters = ref<Record<string, string>>({
  运行编号: '',
  所属泵站: '',
  泵组编号: '',
})
const nowTick = ref(Date.now())
const timer = window.setInterval(() => {
  nowTick.value = Date.now()
}, 30000)

const stats = computed(() => runStats(rows.value))
const statCards = computed(() => [
  { label: '运行中泵组', value: stats.value.running, alert: false },
  { label: '待开机记录', value: stats.value.waiting, alert: false },
  { label: '已停机泵组', value: stats.value.stopped, alert: false },
  { label: '故障停机泵组', value: stats.value.fault, alert: stats.value.fault > 0 },
  { label: '电流超标被挡', value: stats.value.overrun, alert: stats.value.overrun > 0 },
])
const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isOverrun(row: EntryRow): boolean {
  return Boolean(currentInfo(row)?.overrun)
}
function overInfo(row: EntryRow) {
  return currentInfo(row)
}

// 运行中按开机时间实时累计；已停机用停机时算好的那段时长。
function durationOf(row: EntryRow): string {
  nowTick.value
  if (String(row.status) === '运行中' && row['开机时间']) {
    return formatDuration(String(row['开机时间']), nowText())
  }
  return row['运行时长'] ? String(row['运行时长']) : '—'
}

// 动作只露出当前状态的下一格，状态机在服务层再兜一道。
function actionsFor(row: EntryRow): { name: string; fault: boolean }[] {
  switch (String(row.status)) {
    case '待开机':
      return [
        { name: '提交开机', fault: false },
        ...(isOverrun(row) ? [{ name: '改记电流', fault: false }] : []),
      ]
    case '运行中':
      return [
        { name: '登记停机', fault: false },
        { name: '上报故障', fault: true },
      ]
    default:
      return []
  }
}

function resetFilters() {
  filters.value = { 运行编号: '', 所属泵站: '', 泵组编号: '' }
  lookupTip.value = ''
  lookupError.value = false
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// 三格一起查：编号 + 泵站 + 泵组编号逐格核对，查不到说明是哪一格没对上。
function locateRow() {
  const code = filters.value['运行编号']?.trim() ?? ''
  const station = filters.value['所属泵站']?.trim() ?? ''
  const pumpCode = filters.value['泵组编号']?.trim() ?? ''
  if (!code && !station && !pumpCode) {
    lookupError.value = true
    lookupTip.value = '三格都空着：至少填上运行编号，或所属泵站 + 泵组编号一起填，才能核对。'
    return
  }
  const result = lookupRun(code, station, pumpCode)
  if (result.row) {
    lookupError.value = false
    lookupTip.value = `核对一致：${result.row['运行编号']} ／ ${result.row['所属泵站']} ／ ${result.row['泵组编号']}，当前状态「${result.row.status}」。`
    filters.value = {
      运行编号: String(result.row['运行编号']),
      所属泵站: String(result.row['所属泵站']),
      泵组编号: String(result.row['泵组编号']),
    }
    reload()
    return
  }
  lookupError.value = true
  lookupTip.value = result.mismatches.length
    ? result.mismatches.join('；')
    : '三格没对上，请按格子检查运行编号、所属泵站、泵组编号。'
}

// ---- 弹窗 ----
type DialogMode = 'create' | 'start' | 'stop' | 'current'

const dialog = reactive<{
  open: boolean
  mode: DialogMode
  title: string
  error: string
  fault: boolean
}>({ open: false, mode: 'create', title: '', error: '', fault: false })

const activeRow = ref<EntryRow | null>(null)
const form = reactive({
  code: '',
  station: '',
  pumpCode: '',
  current: 0,
  flow: '',
  operator: '',
  recordTime: '',
  startTime: '',
  stopTime: '',
  conclusion: '',
})

const unitsByStation = computed(() =>
  pumpUnits.filter((unit) => unit.station === form.station),
)
const selectedUnit = computed(() => findUnit(form.station, form.pumpCode))
const formOverrun = computed(
  () => Boolean(selectedUnit.value) && Number(form.current) > selectedUnit.value!.ratedCurrent,
)
const overPreview = computed(() => {
  if (!selectedUnit.value) {
    return 0
  }
  return Math.round((Number(form.current) - selectedUnit.value.ratedCurrent) * 10) / 10
})
const confirmText = computed(() => {
  switch (dialog.mode) {
    case 'create':
      return '登记为待开机'
    case 'start':
      return '确认开机'
    case 'stop':
      return dialog.fault ? '上报故障并停机' : '确认停机'
    case 'current':
      return '保存改记'
    default:
      return '确定'
  }
})

function resetForm() {
  Object.assign(form, {
    code: '',
    station: '',
    pumpCode: '',
    current: 0,
    flow: '',
    operator: '',
    recordTime: toLocalInput(nowText()),
    startTime: toLocalInput(nowText()),
    stopTime: toLocalInput(nowText()),
    conclusion: '',
  })
}

function toLocalInput(text: string): string {
  return text.replace(' ', 'T')
}

function openCreate() {
  activeRow.value = null
  resetForm()
  dialog.open = true
  dialog.mode = 'create'
  dialog.title = '登记泵组运行记录'
  dialog.error = ''
  dialog.fault = false
}

function onStationChange() {
  form.pumpCode = ''
}

function onPumpChange() {
  if (selectedUnit.value) {
    form.current = selectedUnit.value.ratedCurrent
  }
}

function openAction(name: string, row: EntryRow) {
  activeRow.value = row
  dialog.error = ''
  dialog.fault = name === '上报故障'
  if (name === '提交开机') {
    dialog.mode = 'start'
    dialog.title = `提交开机 · ${row['运行编号']}`
    form.startTime = toLocalInput(nowText())
    dialog.open = true
    return
  }
  if (name === '改记电流') {
    dialog.mode = 'current'
    dialog.title = `改记运行电流 · ${row['运行编号']}`
    form.current = Number(row['运行电流(A)'])
    dialog.open = true
    return
  }
  // 登记停机 / 上报故障
  dialog.mode = 'stop'
  dialog.title = `${name} · ${row['运行编号']}`
  form.stopTime = toLocalInput(nowText())
  form.conclusion = ''
  dialog.open = true
}

function closeDialog() {
  dialog.open = false
  dialog.error = ''
  activeRow.value = null
}

function fail(message: string) {
  dialog.error = message
}

function submitDialog() {
  if (dialog.mode === 'create') {
    const result = createRun({
      code: form.code.trim() || suggestRunCode(),
      station: form.station,
      pumpCode: form.pumpCode,
      current: Number(form.current),
      flow: form.flow,
      operator: form.operator,
      recordTime: form.recordTime.replace('T', ' '),
    })
    if (!result.ok) {
      fail(result.message)
      return
    }
    closeDialog()
    errorMessage.value = result.message
    reload()
    return
  }
  if (!activeRow.value) {
    return
  }
  const id = Number(activeRow.value.id)
  if (dialog.mode === 'start') {
    const result = startRun(id, form.startTime.replace('T', ' '))
    if (!result.ok) {
      fail(result.message)
      return
    }
    closeDialog()
    errorMessage.value = result.message
    reload()
    return
  }
  if (dialog.mode === 'current') {
    const result = updateRunCurrent(id, Number(form.current))
    if (!result.ok) {
      fail(result.message)
      return
    }
    closeDialog()
    errorMessage.value = result.message
    reload()
    return
  }
  if (dialog.mode === 'stop') {
    const result = stopRun(id, {
      stopTime: form.stopTime.replace('T', ' '),
      conclusion: form.conclusion,
      fault: dialog.fault,
    })
    if (!result.ok) {
      fail(result.message)
      return
    }
    closeDialog()
    errorMessage.value = result.message
    reload()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (!payload.items.length) {
      lookupError.value = true
      lookupTip.value = '三格联合查询没查到记录：请检查是运行编号、所属泵站还是泵组编号这一格没对上（可用「三格定位核对」逐格提示）。'
    } else if (!lookupTip.value) {
      lookupTip.value = ''
      lookupError.value = false
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '泵组运行列表读取失败'
  }
}

onMounted(reload)
onBeforeUnmount(() => window.clearInterval(timer))
</script>
