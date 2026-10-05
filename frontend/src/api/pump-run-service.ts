import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 泵组运行开机规矩：状态只能 待开机 → 运行中 → 已停机 顺向流转，
// 同一台泵运行中禁止重复开机；运行电流超额定值要标出并挡住开机确认；
// 停机按实际时间累加运行时长（跨零点自然连续），停机结论落入检修排期待修清单。

const RUN_KEY = 'pumprun'
const MAINT_KEY = 'pumpmaint'

export const RUN_FLOW = ['待开机', '运行中', '已停机'] as const
const START_ACTION = '提交开机'
const STOP_ACTION = '登记停机'

export const STOP_CONCLUSIONS = ['正常停机', '故障停机', '振动偏大', '电流异常', '其他'] as const
export type StopConclusion = (typeof STOP_CONCLUSIONS)[number]

// 各停机结论对应的检修类别，落进检修排期的待修清单。
const CONCLUSION_TO_MAINT_KIND: Record<string, string> = {
  正常停机: '日常养护',
  故障停机: '故障停机待修',
  振动偏大: '振动偏大待修',
  电流异常: '电流异常待查',
  其他: '停机后检查',
}

export type PumpRunDraft = {
  运行编号: string
  所属泵站: string
  泵组编号: string
  额定电流: number
  运行电流: number
  出水流量: string
  值班人: string
  记录时间: string
}

export type PumpStopDraft = {
  停机时间: string
  停机结论: StopConclusion
  结论说明: string
}

export type PumpRunQuery = {
  运行编号?: string
  所属泵站?: string
  泵组编号?: string
}

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toDate(value: string): Date | null {
  if (!value) return null
  // 支持 "2026-10-01T08:00"（datetime-local）与 "2026-10-01 08:00" 两种写法。
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function nowStamp(): string {
  return formatStamp(new Date())
}

// 超额定电流判定：返回超限幅值（A），未超限返回 0；数据非法时不判定超限。
export function currentOverrun(rated: unknown, actual: unknown): number {
  const ratedNum = num(rated)
  const actualNum = num(actual)
  if (!Number.isFinite(ratedNum) || !Number.isFinite(actualNum) || ratedNum <= 0) {
    return 0
  }
  return actualNum > ratedNum ? Math.round((actualNum - ratedNum) * 10) / 10 : 0
}

export function isOverCurrent(row: EntryRow): boolean {
  return currentOverrun(row['额定电流(A)'], row['运行电流(A)']) > 0
}

// 运行时长：按实际时间戳差值计算，跨零点只是时间轴上的自然连续，不做截断。
export function durationMinutes(start: string, stop: string): number | null {
  const startAt = toDate(start)
  const stopAt = toDate(stop)
  if (!startAt || !stopAt) return null
  const diff = Math.round((stopAt.getTime() - startAt.getTime()) / 60000)
  return diff
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}小时` : `${hours}小时${rest}分`
}

function samePump(a: EntryRow, station: string, pumpNo: string): boolean {
  return String(a['所属泵站'] ?? '').trim() === station.trim()
    && String(a['泵组编号'] ?? '').trim() === pumpNo.trim()
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function suggestRunCode(): string {
  const date = new Date()
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const count = listRows(RUN_KEY).filter((row) =>
    String(row['运行编号'] ?? '').includes(stamp),
  ).length + 1
  return `YX-${stamp}-${String(count).padStart(3, '0')}`
}

// 登记一条待开机记录。电流登记即超限时先把记录单独标出来，开机确认这一步再挡住。
export function createPumpRun(draft: PumpRunDraft): ActionResult {
  const rows = listRows(RUN_KEY)

  const required: [keyof PumpRunDraft, string][] = [
    ['运行编号', '运行编号'],
    ['所属泵站', '所属泵站'],
    ['泵组编号', '泵组编号'],
    ['值班人', '值班人'],
    ['记录时间', '记录时间'],
  ]
  for (const [field, label] of required) {
    if (!String(draft[field] ?? '').trim()) {
      return { ok: false, message: `${label}这一格没填，登记不了` }
    }
  }
  if (!Number.isFinite(draft.额定电流) || draft.额定电流 <= 0) {
    return { ok: false, message: '额定电流(A)这一格没对上：要填大于0的数字' }
  }
  if (!Number.isFinite(draft.运行电流) || draft.运行电流 < 0) {
    return { ok: false, message: '运行电流(A)这一格没对上：要填不小于0的数字' }
  }
  if (rows.some((row) => String(row['运行编号'] ?? '').trim() === draft.运行编号.trim())) {
    return { ok: false, message: `运行编号「${draft.运行编号}」已经登记过，不能重复登记` }
  }

  const over = currentOverrun(draft.额定电流, draft.运行电流)
  const recordStamp = draft.记录时间.includes('T')
    ? draft.记录时间.replace('T', ' ')
    : draft.记录时间

  const row: EntryRow = {
    id: nextId(rows),
    status: '待开机',
    pending: true,
    abnormal: over > 0,
    运行编号: draft.运行编号.trim(),
    所属泵站: draft.所属泵站.trim(),
    泵组编号: draft.泵组编号.trim(),
    '额定电流(A)': draft.额定电流,
    '运行电流(A)': draft.运行电流,
    '出水流量(m³/h)': draft.出水流量.trim(),
    值班人: draft.值班人.trim(),
    记录时间: recordStamp,
    开机时间: '',
    停机时间: '',
    运行时长: '',
    停机结论: '',
    运行状态: '待开机',
  }
  if (over > 0) {
    row['超限幅值(A)'] = over
  }
  saveRows(RUN_KEY, [...rows, row])

  if (over > 0) {
    return {
      ok: true,
      message: `记录已登记并标出：运行电流 ${draft.运行电流}A 超过额定 ${draft.额定电流}A，超限 ${over}A，「提交开机」已被挡住，需先更正电流`,
    }
  }
  return { ok: true, message: `待开机记录 ${draft.运行编号} 已登记，可以提交开机` }
}

function assertFlow(current: string, target: string): ActionResult | null {
  const from = RUN_FLOW.indexOf(current as (typeof RUN_FLOW)[number])
  const to = RUN_FLOW.indexOf(target as (typeof RUN_FLOW)[number])
  if (from < 0) {
    return { ok: false, message: `当前状态「${current}」不在开机规矩（待开机→运行中→已停机）里，不能操作` }
  }
  if (to !== from + 1) {
    return {
      ok: false,
      message: `状态只能从「${RUN_FLOW[from]}」顺走到「${RUN_FLOW[from + 1] ?? RUN_FLOW[from]}」，不能跳到「${target}」，该操作已打回`,
    }
  }
  return null
}

// 提交开机：状态必须是待开机；同一台泵已有运行中记录时禁止再开第二条；电流超限挡住确认。
export function startPumpRun(id: number, startAt: string): ActionResult {
  const rows = listRows(RUN_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的泵组运行记录` }
  }
  const row = rows[index]
  const current = String(row.status)
  const flowError = assertFlow(current, '运行中')
  if (flowError) return flowError

  const station = String(row['所属泵站'] ?? '').trim()
  const pumpNo = String(row['泵组编号'] ?? '').trim()
  const occupied = rows.find(
    (other) => Number(other.id) !== id
      && String(other.status) === '运行中'
      && samePump(other, station, pumpNo),
  )
  if (occupied) {
    return {
      ok: false,
      message: `${station} ${pumpNo} 已在运行中（运行编号 ${occupied['运行编号']}），同一台泵不允许再开第二条`,
    }
  }

  const over = currentOverrun(row['额定电流(A)'], row['运行电流(A)'])
  if (over > 0) {
    return {
      ok: false,
      message: `开机确认被挡住：运行电流 ${row['运行电流(A)']}A 超过额定 ${row['额定电流(A)']}A，超限 ${over}A，请先更正电流后再开机`,
    }
  }

  const stamp = (startAt ? (startAt.includes('T') ? startAt.replace('T', ' ') : startAt) : nowStamp())
  const updated: EntryRow = {
    ...row,
    status: '运行中',
    pending: true,
    abnormal: false,
    开机时间: stamp,
    运行状态: '运行中',
  }
  delete updated['超限幅值(A)']
  const next = [...rows]
  next[index] = updated
  saveRows(RUN_KEY, next)
  return { ok: true, message: `${row['运行编号']} 已${START_ACTION}，开机时间 ${stamp}` }
}

function createMaintTodo(row: EntryRow, minutes: number, stopAt: string): void {
  const maintRows = listRows(MAINT_KEY)
  const conclusion = String(row['停机结论'] ?? '')
  const note = String(row['结论说明'] ?? '').trim()
  const parts = note ? `${conclusion}（${note}）` : conclusion
  // 结论可能带着“（说明）”，检修类别按括号前的结论本体来匹配。
  const bareConclusion = conclusion.split('（')[0].trim()

  const todo: EntryRow = {
    id: nextId(maintRows),
    status: '待开工',
    pending: true,
    abnormal: false,
    检修编号: nextMaintCode(maintRows),
    所属泵站: row['所属泵站'],
    泵组编号: row['泵组编号'],
    检修类别: CONCLUSION_TO_MAINT_KIND[bareConclusion] ?? '停机后检查',
    检修班组: '待派班',
    计划工期: '待排期',
    完成日期: '',
    更换部件: parts,
    来源运行编号: row['运行编号'],
    停机结论: parts,
    运行时长: formatDuration(minutes),
    检修状态: '待开工',
  }
  saveRows(MAINT_KEY, [...maintRows, todo])
}

function nextMaintCode(rows: EntryRow[]): string {
  const date = new Date()
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const count = rows.filter((row) => String(row['检修编号'] ?? '').includes(stamp)).length + 1
  return `JX-${stamp}-${String(count).padStart(3, '0')}`
}

// 登记停机：状态必须是运行中；停机时间不得早于开机；算出实际运行时长并生成检修待办。
export function stopPumpRun(id: number, draft: PumpStopDraft): ActionResult {
  const rows = listRows(RUN_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的泵组运行记录` }
  }
  const row = rows[index]
  const flowError = assertFlow(String(row.status), '已停机')
  if (flowError) return flowError

  if (!draft.停机时间) {
    return { ok: false, message: '停机时间这一格没填，算不出这一段运行时长' }
  }
  if (!STOP_CONCLUSIONS.includes(draft.停机结论)) {
    return { ok: false, message: '停机结论没有选，落不到检修排期的待修清单' }
  }
  const stopAt = draft.停机时间.includes('T') ? draft.停机时间.replace('T', ' ') : draft.停机时间
  const minutes = durationMinutes(String(row['开机时间'] ?? ''), stopAt)
  if (minutes === null) {
    return { ok: false, message: `开机时间「${row['开机时间'] || '空'}」或停机时间「${stopAt}」没对上，时长算不出来` }
  }
  if (minutes < 0) {
    return { ok: false, message: `停机时间 ${stopAt} 早于开机时间 ${row['开机时间']}，时间填反了，已打回` }
  }

  const conclusionText = draft.结论说明.trim()
    ? `${draft.停机结论}（${draft.结论说明.trim()}）`
    : draft.停机结论

  const updated: EntryRow = {
    ...row,
    status: '已停机',
    pending: false,
    停机时间: stopAt,
    运行时长: formatDuration(minutes),
    '运行时长(分钟)': minutes,
    停机结论: conclusionText,
    运行状态: '已停机',
  }
  const next = [...rows]
  next[index] = updated
  saveRows(RUN_KEY, next)

  createMaintTodo(updated, minutes, stopAt)

  return {
    ok: true,
    message: `${row['运行编号']} 已${STOP_ACTION}：运行时长 ${formatDuration(minutes)}（跨零点按实际时间累加），结论「${draft.停机结论}」已生成检修排期待办`,
  }
}

// 超限电流更正：只有待开机记录允许更正；更正后解除超限标记，才放得过去开机确认。
export function correctCurrent(id: number, actual: number): ActionResult {
  const rows = listRows(RUN_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的泵组运行记录` }
  }
  const row = rows[index]
  if (String(row.status) !== '待开机') {
    return { ok: false, message: `记录已是「${row.status}」，运行电流只能在待开机阶段更正` }
  }
  if (!Number.isFinite(actual) || actual < 0) {
    return { ok: false, message: '更正后的运行电流(A)这一格没对上：要填不小于0的数字' }
  }
  const over = currentOverrun(row['额定电流(A)'], actual)
  const updated: EntryRow = {
    ...row,
    '运行电流(A)': actual,
    abnormal: over > 0,
  }
  if (over > 0) {
    updated['超限幅值(A)'] = over
  } else {
    delete updated['超限幅值(A)']
  }
  const next = [...rows]
  next[index] = updated
  saveRows(RUN_KEY, next)

  if (over > 0) {
    return {
      ok: true,
      message: `电流已改为 ${actual}A，仍超过额定 ${row['额定电流(A)']}A，超限 ${over}A，开机确认继续挡住`,
    }
  }
  return { ok: true, message: `电流已更正为 ${actual}A，未超额定值，可以提交开机` }
}

// 运行编号 / 所属泵站 / 泵组编号 三格一起查。
// 查不到时逐格体检，说明到底是哪一格没对上，而不是只甩一句“查无结果”。
export function queryPumpRuns(query: PumpRunQuery): {
  items: EntryRow[]
  total: number
  notice: string
} {
  const rows = listRows(RUN_KEY)
  const pairs = (Object.entries(query) as [keyof PumpRunQuery, string][])
    .map(([field, value]) => [field, value.trim()] as const)
    .filter(([, value]) => value !== '')

  if (pairs.length === 0) {
    return { items: rows, total: rows.length, notice: '' }
  }

  const matched = rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value)),
  )
  if (matched.length > 0) {
    return { items: matched, total: matched.length, notice: '' }
  }

  const labels: Record<keyof PumpRunQuery, string> = {
    运行编号: '运行编号',
    所属泵站: '所属泵站',
    泵组编号: '泵组编号',
  }
  const missing = pairs
    .filter(([field, value]) => !rows.some((row) => String(row[field] ?? '').includes(value)))
    .map(([field, value]) => `「${labels[field]}」这一格没对上：没有值包含“${value}”的记录`)

  const partial = pairs.filter(([field, value]) =>
    rows.some((row) => String(row[field] ?? '').includes(value)),
  )
  let notice: string
  if (missing.length === pairs.length) {
    notice = `三格联查没有对上任何记录：${missing.join('；')}`
  } else {
    const okLabels = partial.map(([field]) => labels[field]).join('、')
    notice = `组合条件没有同时命中：${okLabels} 单格能查到，但${missing.join('；')}；请核对各格是否属于同一条记录`
  }
  return { items: [], total: 0, notice }
}
