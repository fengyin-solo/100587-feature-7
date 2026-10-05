<template>
  <section class="page" data-module="pumprun">
    <header class="page-head">
      <div>
        <h2>泵组运行管理</h2>
        <p class="page-desc">
          开机规矩：状态只能 待开机 → 运行中 → 已停机 顺向流转，跳着改打回；同一台泵运行中禁止再开第二条；
          运行电流超额定值单独标出并挡住确认；停机按实际时间累加时长（跨零点连续），停机结论自动落入检修排期待修清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记泵组运行记录</button>
        <button class="btn" type="button" @click="exportRows">导出泵组运行清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card" :class="{ 'stat-warn': item.warn }">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>运行编号</span>
        <input v-model="query.运行编号" placeholder="按运行编号查，如 YX-20261001-001" />
      </label>
      <label class="filter-item">
        <span>所属泵站</span>
        <input v-model="query.所属泵站" placeholder="按所属泵站查，如 滨江一号泵站" />
      </label>
      <label class="filter-item">
        <span>泵组编号</span>
        <input v-model="query.泵组编号" placeholder="按泵组编号查，如 1#泵" />
      </label>
      <button class="btn" type="submit">三格联查</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="queryNotice" class="warn-box">{{ queryNotice }}</p>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-over': isOver(row) }">
            <td v-for="column in columns" :key="column">
              <template v-if="column === '运行电流(A)'">
                <span :class="{ 'current-over': isOver(row) }">{{ row[column] ?? '—' }}</span>
                <span v-if="isOver(row)" class="over-tag">
                  超额定 {{ row['超限幅值(A)'] ?? overOf(row) }}A
                </span>
              </template>
              <template v-else>{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</template>
            </td>
            <td>
              <span class="status-pill" :class="`status-${statusIndex(row.status)}`">{{ row.status }}</span>
            </td>
            <td class="row-actions">
              <button
                v-if="row.status === '待开机'"
                class="link"
                type="button"
                @click="openStart(row)"
              >
                提交开机
              </button>
              <button
                v-if="row.status === '待开机' && isOver(row)"
                class="link warn-link"
                type="button"
                @click="openCorrect(row)"
              >
                更正电流
              </button>
              <button
                v-if="row.status === '运行中'"
                class="link"
                type="button"
                @click="openStop(row)"
              >
                登记停机
              </button>
              <span v-if="row.status === '已停机'" class="muted-text">流程已走完</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的泵组运行记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条泵组运行记录</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 登记待开机记录 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记泵组运行记录（待开机）</h3>
        <div class="form-grid">
          <label>
            <span>运行编号 *</span>
            <input v-model="createForm.运行编号" placeholder="如 YX-20261005-001" />
          </label>
          <label>
            <span>所属泵站 *</span>
            <input v-model="createForm.所属泵站" list="station-options" placeholder="如 滨江一号泵站" />
            <datalist id="station-options">
              <option v-for="name in stationNames" :key="name" :value="name" />
            </datalist>
          </label>
          <label>
            <span>泵组编号 *</span>
            <input v-model="createForm.泵组编号" placeholder="如 1#泵" />
          </label>
          <label>
            <span>额定电流(A) *</span>
            <input v-model.number="createForm.额定电流" type="number" min="0" step="0.1" placeholder="该泵铭牌额定值" />
          </label>
          <label>
            <span>运行电流(A) *</span>
            <input v-model.number="createForm.运行电流" type="number" min="0" step="0.1" placeholder="开机前实测值" />
          </label>
          <label>
            <span>出水流量(m³/h)</span>
            <input v-model="createForm.出水流量" placeholder="如 1800" />
          </label>
          <label>
            <span>值班人 *</span>
            <input v-model="createForm.值班人" />
          </label>
          <label>
            <span>记录时间 *</span>
            <input v-model="createForm.记录时间" type="datetime-local" />
          </label>
        </div>
        <p v-if="createPreviewOver > 0" class="warn-box">
          运行电流 {{ createForm.运行电流 }}A 超过额定 {{ createForm.额定电流 }}A，超限 {{ createPreviewOver }}A：
          记录会单独标红，且「提交开机」将被挡住，需先更正电流。
        </p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">登记</button>
        </div>
      </div>
    </div>

    <!-- 提交开机 -->
    <div v-if="startOpen" class="modal-mask" @click.self="startOpen = false">
      <div class="modal">
        <h3>提交开机 · {{ activeRow?.['运行编号'] }}</h3>
        <dl class="detail-list">
          <div><dt>所属泵站</dt><dd>{{ activeRow?.['所属泵站'] }}</dd></div>
          <div><dt>泵组编号</dt><dd>{{ activeRow?.['泵组编号'] }}</dd></div>
          <div><dt>额定/运行电流</dt><dd>{{ activeRow?.['额定电流(A)'] }}A / {{ activeRow?.['运行电流(A)'] }}A</dd></div>
        </dl>
        <label class="full-field">
          <span>开机时间 *</span>
          <input v-model="startTime" type="datetime-local" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="startOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitStart">确认开机</button>
        </div>
      </div>
    </div>

    <!-- 登记停机 -->
    <div v-if="stopOpen" class="modal-mask" @click.self="stopOpen = false">
      <div class="modal">
        <h3>登记停机 · {{ activeRow?.['运行编号'] }}</h3>
        <dl class="detail-list">
          <div><dt>所属泵站/泵组</dt><dd>{{ activeRow?.['所属泵站'] }} {{ activeRow?.['泵组编号'] }}</dd></div>
          <div><dt>开机时间</dt><dd>{{ activeRow?.['开机时间'] }}</dd></div>
        </dl>
        <div class="form-grid">
          <label>
            <span>停机时间 *</span>
            <input v-model="stopForm.停机时间" type="datetime-local" />
          </label>
          <label>
            <span>停机结论 *</span>
            <select v-model="stopForm.停机结论">
              <option value="" disabled>请选择结论</option>
              <option v-for="item in conclusions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
        </div>
        <label class="full-field">
          <span>结论说明（落到检修待修清单）</span>
          <textarea v-model="stopForm.结论说明" rows="2" placeholder="如 轴承处有异响，建议开盖检查"></textarea>
        </label>
        <p v-if="stopPreview !== null" class="hint-box">
          本段运行时长按实际时间差计算为 <strong>{{ formatDuration(stopPreview) }}</strong>
          （跨零点连续累加），停机后将自动在检修排期生成一条待开工待办。
        </p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="stopOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitStop">确认停机</button>
        </div>
      </div>
    </div>

    <!-- 更正超限电流 -->
    <div v-if="correctOpen" class="modal-mask" @click.self="correctOpen = false">
      <div class="modal">
        <h3>更正运行电流 · {{ activeRow?.['运行编号'] }}</h3>
        <p v-if="activeRow && isOver(activeRow)" class="warn-box">
          当前运行电流 {{ activeRow?.['运行电流(A)'] }}A 超过额定 {{ activeRow?.['额定电流(A)'] }}A，
          超限 {{ activeRow?.['超限幅值(A)'] ?? (activeRow ? overOf(activeRow) : 0) }}A，开机确认已挡住。
        </p>
        <label class="full-field">
          <span>复核后的运行电流(A) *</span>
          <input v-model.number="correctValue" type="number" min="0" step="0.1" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="correctOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCorrect">提交更正</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  correctCurrent,
  createPumpRun,
  currentOverrun,
  durationMinutes,
  formatDuration,
  isOverCurrent,
  queryPumpRuns,
  startPumpRun,
  stopPumpRun,
  suggestRunCode,
  STOP_CONCLUSIONS,
  type PumpRunDraft,
  type PumpStopDraft,
  type StopConclusion,
} from '@/api/pump-run-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pumprun')
const columns = [
  '运行编号', '所属泵站', '泵组编号', '额定电流(A)', '运行电流(A)',
  '出水流量(m³/h)', '值班人', '记录时间', '开机时间', '停机时间',
  '运行时长', '停机结论',
]
const statuses = ['待开机', '运行中', '已停机']
const conclusions = STOP_CONCLUSIONS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(false)
const queryNotice = ref('')
const query = reactive({ 运行编号: '', 所属泵站: '', 泵组编号: '' })

const activeRow = ref<EntryRow | null>(null)
const createOpen = ref(false)
const startOpen = ref(false)
const stopOpen = ref(false)
const correctOpen = ref(false)

const emptyCreate = (): PumpRunDraft => ({
  运行编号: suggestRunCode(),
  所属泵站: '',
  泵组编号: '',
  额定电流: 200,
  运行电流: 0,
  出水流量: '',
  值班人: '',
  记录时间: toDatetimeLocal(new Date()),
})
const createForm = reactive<PumpRunDraft>(emptyCreate())
const startTime = ref(toDatetimeLocal(new Date()))
const stopForm = reactive<PumpStopDraft>({ 停机时间: '', 停机结论: '正常停机', 结论说明: '' })
const correctValue = ref<number>(0)

const stationNames = computed(() => {
  const names = listRows('pumpstation').map((row) => String(row['站名'] ?? '').trim())
  return [...new Set(names.filter(Boolean))]
})

const stats = computed(() => [
  { label: '待开机记录', value: countByStatus('待开机'), warn: false },
  { label: '运行中泵组', value: countByStatus('运行中'), warn: false },
  { label: '已停机记录', value: countByStatus('已停机'), warn: false },
  { label: '电流超限待确认', value: rows.value.filter((row) => isOver(row)).length, warn: true },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const createPreviewOver = computed(() =>
  currentOverrun(createForm.额定电流, createForm.运行电流),
)

const stopPreview = computed(() => {
  if (!activeRow.value || !stopForm.停机时间) return null
  const minutes = durationMinutes(String(activeRow.value['开机时间'] ?? ''), stopForm.停机时间.replace('T', ' '))
  return minutes !== null && minutes >= 0 ? minutes : null
})

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function isOver(row: EntryRow): boolean {
  return isOverCurrent(row)
}

function overOf(row: EntryRow): number {
  return currentOverrun(row['额定电流(A)'], row['运行电流(A)'])
}

function statusIndex(status: unknown): number {
  const index = statuses.indexOf(String(status))
  return index < 0 ? 0 : index
}

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function flash(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function resetFilters() {
  query.运行编号 = ''
  query.所属泵站 = ''
  query.泵组编号 = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  Object.assign(createForm, emptyCreate())
  createOpen.value = true
}

function submitCreate() {
  const result = createPumpRun({ ...createForm })
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  createOpen.value = false
  flash(true, result.message)
  reload()
}

function openStart(row: EntryRow) {
  activeRow.value = row
  startTime.value = toDatetimeLocal(new Date())
  startOpen.value = true
}

function submitStart() {
  if (!activeRow.value) return
  const result = startPumpRun(Number(activeRow.value.id), startTime.value)
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  startOpen.value = false
  flash(true, result.message)
  reload()
}

function openStop(row: EntryRow) {
  activeRow.value = row
  stopForm.停机时间 = toDatetimeLocal(new Date())
  stopForm.停机结论 = '正常停机' as StopConclusion
  stopForm.结论说明 = ''
  stopOpen.value = true
}

function submitStop() {
  if (!activeRow.value) return
  const result = stopPumpRun(Number(activeRow.value.id), { ...stopForm })
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  stopOpen.value = false
  flash(true, result.message)
  reload()
}

function openCorrect(row: EntryRow) {
  activeRow.value = row
  correctValue.value = Number(row['运行电流(A)']) || 0
  correctOpen.value = true
}

function submitCorrect() {
  if (!activeRow.value) return
  const result = correctCurrent(Number(activeRow.value.id), correctValue.value)
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  correctOpen.value = false
  flash(true, result.message)
  reload()
}

function reload() {
  message.value = ''
  const payload = queryPumpRuns({ ...query })
  rows.value = payload.items
  total.value = payload.total
  queryNotice.value = payload.notice
}

onMounted(reload)
</script>
