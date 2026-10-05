<template>
  <section class="page" data-module="pumpmaint">
    <header class="page-head">
      <div>
        <h2>泵组检修管理</h2>
        <p class="page-desc">泵组一停机，停机结论自动落到下面的待修清单，生成一条「待开工」检修待办；开工、完工同样只能顺状态往前走。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出检修清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card" :class="{ alert: item.alert }">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="todo-panel">
      <h3 class="todo-title">待修清单（待开工）<span class="todo-count">{{ todoRows.length }} 条</span></h3>
      <p v-if="!todoRows.length" class="todo-empty">暂时没有待修泵组。泵组在「泵组运行」里停机或上报故障后，会自动进这张清单。</p>
      <table v-else class="data-table todo-table">
        <thead>
          <tr>
            <th>检修编号</th>
            <th>所属泵站</th>
            <th>泵组编号</th>
            <th>检修类别</th>
            <th>来源运行单</th>
            <th>待修结论</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in todoRows" :key="`todo-${String(row.id)}`" :class="{ 'row-fault': row.abnormal }">
            <td>{{ row['检修编号'] }}</td>
            <td>{{ row['所属泵站'] }}</td>
            <td>{{ row['泵组编号'] }}</td>
            <td>
              <span class="tag" :class="row['检修类别'] === '故障检修' ? 'tag-danger' : 'tag-info'">
                {{ row['检修类别'] }}
              </span>
            </td>
            <td>{{ row['来源运行单'] || '手工登记' }}</td>
            <td class="cell-conclusion">{{ row['待修结论'] || '—' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="runAction('提交开工', row)">提交开工</button>
              <button class="link danger" type="button" @click="runAction('申请延期', row)">申请延期</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-fault': row.status === '故障相关' }">
          <td>{{ row['检修编号'] }}</td>
          <td>{{ row['所属泵站'] }}</td>
          <td>{{ row['泵组编号'] }}</td>
          <td>{{ row['检修类别'] }}</td>
          <td>{{ row['检修班组'] }}</td>
          <td>{{ row['计划工期'] }}</td>
          <td>{{ row['完成日期'] || '—' }}</td>
          <td>{{ row['更换部件'] || '—' }}</td>
          <td>{{ row['来源运行单'] || '—' }}</td>
          <td class="cell-conclusion">{{ row['待修结论'] || '—' }}</td>
          <td><span class="status-badge" :class="`status-${row.status}`">{{ row.status }}</span></td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              :class="{ danger: action === '申请延期' }"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="actionsFor(row).length === 0" class="muted-text">无</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无泵组检修数据，泵组停机后会自动登记待修待办</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条泵组检修记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pumpmaint')
const columns = ["检修编号", "所属泵站", "泵组编号", "检修类别", "检修班组", "计划工期", "完成日期", "更换部件", "来源运行单", "待修结论"]
const statuses = ["待开工", "检修中", "已完工", "已延期"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["检修编号", "所属泵站", "泵组编号"]

const todoRows = computed(() =>
  rows.value
    .filter((row) => String(row.status) === '待开工')
    .sort((a, b) => Number(b.abnormal) - Number(a.abnormal)),
)
const statCards = computed(() => {
  const count = (status: string) => rows.value.filter((row) => String(row.status) === status).length
  const faultTodos = todoRows.value.filter((row) => row.abnormal).length
  return [
    { label: '待开工（待修清单）', value: count('待开工'), alert: count('待开工') > 0 },
    { label: '其中故障待修', value: faultTodos, alert: faultTodos > 0 },
    { label: '检修中泵组', value: count('检修中'), alert: false },
    { label: '已完工泵组', value: count('已完工'), alert: false },
  ]
})
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 只露当前状态允许的下一步动作，终态没有动作。
function actionsFor(row: EntryRow): string[] {
  return meta.transitions?.[String(row.status)] ?? []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '检修记录由泵组停机自动落待办；手工登记入口尚未开放'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '泵组检修列表读取失败'
  }
}

onMounted(reload)
</script>
