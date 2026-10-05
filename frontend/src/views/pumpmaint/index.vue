<template>
  <section class="page" data-module="pumpmaint">
    <header class="page-head">
      <div>
        <h2>泵组检修管理</h2>
        <p class="page-desc">
          检修排期与泵组运行联动：泵组每次登记停机后，停机结论会作为待办自动落到下面的待修清单（待开工），
          带来源运行编号、停机结论与该段运行时长，供排期派班。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记泵组检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出泵组检修清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card" :class="{ 'stat-warn': item.todo }">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="todo-panel">
      <div class="todo-head">
        <h3>待修清单 · 泵组停机待办</h3>
        <span class="todo-count">{{ todoRows.length }} 条待排期</span>
      </div>
      <table v-if="todoRows.length" class="data-table">
        <thead>
          <tr>
            <th>检修编号</th>
            <th>所属泵站</th>
            <th>泵组编号</th>
            <th>检修类别</th>
            <th>来源运行编号</th>
            <th>停机结论</th>
            <th>该段运行时长</th>
            <th>检修班组</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in todoRows" :key="`todo-${String(row.id)}`" class="row-todo">
            <td>{{ row['检修编号'] }}</td>
            <td>{{ row['所属泵站'] }}</td>
            <td>{{ row['泵组编号'] }}</td>
            <td>{{ row['检修类别'] }}</td>
            <td>{{ row['来源运行编号'] || '—' }}</td>
            <td>{{ row['停机结论'] || '—' }}</td>
            <td>{{ row['运行时长'] || '—' }}</td>
            <td>{{ row['检修班组'] }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-todo">暂无停机待办，泵组登记停机后会自动在这里出现。</p>
    </div>

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
          <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-todo': isTodo(row) }">
            <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无泵组检修数据，泵组停机后会自动登记待修待办</td>
          </tr>
        </tbody>
      </table>
    </div>

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
const columns = [
  '检修编号', '所属泵站', '泵组编号', '检修类别', '检修班组',
  '计划工期', '完成日期', '更换部件', '来源运行编号', '停机结论', '运行时长',
]
const actions = ['提交开工', '确认完工', '申请延期']
const statuses = ['待开工', '检修中', '已完工', '已延期']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['检修编号', '所属泵站', '泵组编号']

// 停机落过来的待修待办：待开工且带得有来源运行编号。
const todoRows = computed(() =>
  rows.value.filter((row) => isTodo(row)),
)

const stats = computed(() => [
  { label: '停机待修待办', value: todoRows.value.length, todo: true },
  { label: '待开工检修', value: countByStatus('待开工'), todo: false },
  { label: '检修中泵组', value: countByStatus('检修中'), todo: false },
  { label: '已完工检修', value: countByStatus('已完工'), todo: false },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isTodo(row: EntryRow): boolean {
  return String(row.status) === '待开工'
    && String(row['来源运行编号'] ?? '').trim() !== ''
}

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '泵组检修待办由泵组停机自动生成，暂不支持手工登记'
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
