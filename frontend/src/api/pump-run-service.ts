import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, PumpUnit, RunLookupResult } from '@/data/types'

// 泵组台账：额定电流以这张表为准，所属泵站与泵组编号也照它对格子。
// 纯前端演示先内置；换回后端时把 listPumpUnits 换成接口调用即可，页面不用改。
export const PUMP_UNITS: PumpUnit[] = [
  { station: '滨江一站', pumpCode: 'PUMP-101', pumpName: '1号离心泵', ratedCurrent: 120 },
  { station: '滨江一站', pumpCode: 'PUMP-102', pumpName: '2号离心泵', ratedCurrent: 120 },
  { station: '滨江一站', pumpCode: 'PUMP-103', pumpName: '3号混流泵', ratedCurrent: 180 },
  { station: '河西立交泵站', pumpCode: 'PUMP-201', pumpName: '1号潜水混流泵', ratedCurrent: 210 },
  { station: '河西立交泵站', pumpCode: 'PUMP-202', pumpName: '2号潜水混流泵', ratedCurrent: 210 },
  { station: '东郊雨水泵站', pumpCode: 'PUMP-301', pumpName: '1号轴流泵', ratedCurrent: 260 },
]

const RUN_KEY = 'pumprun'
const MAINT_KEY = 'pumpmaint'

export type CurrentInfo = {
  actual: number
  rated: number
  over: number
  percent: number
  overrun: boolean
}

export function nextId(key: string): number {
  return listRows(key).reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function suggestRunCode(): string {
  return `YX-${String(nextId(RUN_KEY)).padStart(4, '0')}`
}

export function listPumpUnits(): PumpUnit[] {
  return PUMP_UNITS
}

export function findUnit(station: string, pumpCode: string): PumpUnit | undefined {
  return PUMP_UNITS.find((unit) => unit.station === station && unit.pumpCode === pumpCode)
}

export function currentInfo(row: EntryRow): CurrentInfo | null {
  const actual = Number(row['运行电流(A)'])
  const rated = Number(row['额定电流(A)'])
  if (!Number.isFinite(actual) || !Number.isFinite(rated) || rated <= 0) {
    return null
  }
  const over = Math.round((actual - rated) * 10) / 10
  return {
    actual,
    rated,
    over,
    percent: Math.round((over / rated) * 1000) / 10,
    overrun: actual > rated,
  }
}

// 「YYYY-MM-DD HH:mm」→ Date；datetime-local 提交的是「YYYY-MM-DDTHH:mm」，也认。
export function parseTime(value: string): Date | null {
  const text = value.trim()
  if (!text) {
    return null
  }
  const date = new Date(text.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

export function nowText(): string {
  const date = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

// 跨零点不另做处理：直接按开机/停机两个时刻的毫秒差算，自然就是实际累计时长。
export function formatDuration(start: string, end: string): string {
  const begin = parseTime(start)
  const finish = parseTime(end)
  if (!begin || !finish || finish.getTime() < begin.getTime()) {
    return '—'
  }
  const minutes = Math.max(0, Math.round((finish.getTime() - begin.getTime()) / 60000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) {
    return `${rest}分钟`
  }
  return rest === 0 ? `${hours}小时` : `${hours}小时${rest}分钟`
}

export function displayTime(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) {
    return '—'
  }
  // 列表里只展示「月-日 时:分」，录入仍用完整时间。
  const match = text.match(/^\d{4}-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/)
  return match ? `${match[1]}-${match[2]} ${match[3]}` : text
}

function checkUnit(station: string, pumpCode: string): string[] {
  const mismatches: string[] = []
  const stationUnits = PUMP_UNITS.filter((unit) => unit.station === station)
  if (stationUnits.length === 0) {
    mismatches.push(`所属泵站「${station}」在泵组台账里查不到`)
    return mismatches
  }
  const sameCodeElsewhere = PUMP_UNITS.find((unit) => unit.pumpCode === pumpCode)
  const unit = stationUnits.find((item) => item.pumpCode === pumpCode)
  if (!unit && sameCodeElsewhere) {
    mismatches.push(
      `泵组编号「${pumpCode}」挂在「${sameCodeElsewhere.station}」名下，不在「${station}」`,
    )
  } else if (!unit) {
    mismatches.push(
      `泵组编号「${pumpCode}」没对上：「${station}」名下现有 ${stationUnits
        .map((item) => item.pumpCode)
        .join('、')}`,
    )
  }
  return mismatches
}

// 运行编号、所属泵站、泵组编号三格一起查：查不到时逐格说明哪一格没对上。
export function lookupRun(code: string, station: string, pumpCode: string): RunLookupResult {
  const rows = listRows(RUN_KEY)
  const codeText = code.trim()
  const stationText = station.trim()
  const pumpText = pumpCode.trim()
  const byCode = rows.find((row) => String(row['运行编号']) === codeText)

  if (stationText && pumpText) {
    const exact = rows.find(
      (row) =>
        String(row['运行编号']) === codeText &&
        String(row['所属泵站']) === stationText &&
        String(row['泵组编号']) === pumpText,
    )
    if (exact) {
      return { row: exact, mismatches: [] }
    }
  }

  const mismatches: string[] = []
  if (!byCode) {
    mismatches.push(`运行编号「${codeText}」这一格没对上：登记里查不到这条运行单`)
    const sameUnit = rows.filter(
      (row) => String(row['所属泵站']) === stationText && String(row['泵组编号']) === pumpText,
    )
    if (stationText && pumpText && sameUnit.length > 0) {
      mismatches.push(
        `所属泵站、泵组编号两格是对的，该泵最近的运行单是 ${sameUnit
          .map((row) => String(row['运行编号']))
          .join('、')}`,
      )
    } else if (stationText || pumpText) {
      mismatches.push(...checkUnit(stationText, pumpText))
    }
    return { row: null, mismatches }
  }

  if (stationText && String(byCode['所属泵站']) !== stationText) {
    mismatches.push(
      `所属泵站这一格没对上：运行单 ${codeText} 登记的是「${byCode['所属泵站']}」，不是「${stationText}」`,
    )
  }
  if (pumpText && String(byCode['泵组编号']) !== pumpText) {
    mismatches.push(
      `泵组编号这一格没对上：运行单 ${codeText} 登记的是「${byCode['泵组编号']}」，不是「${pumpText}」`,
    )
  }
  return { row: null, mismatches }
}

type RunDraft = {
  code: string
  station: string
  pumpCode: string
  current: number
  flow: string
  operator: string
  recordTime: string
}

export function createRun(draft: RunDraft): ActionResult & { id?: number } {
  const code = draft.code.trim()
  const station = draft.station.trim()
  const pumpCode = draft.pumpCode.trim()
  if (!code) {
    return { ok: false, message: '运行编号这一格不能为空' }
  }
  const rows = listRows(RUN_KEY)
  if (rows.some((row) => String(row['运行编号']) === code)) {
    return { ok: false, message: `运行编号「${code}」已经登记过，不能重复开单` }
  }
  if (!station || !pumpCode) {
    return { ok: false, message: '所属泵站、泵组编号两格都要填上' }
  }
  const unitErrors = checkUnit(station, pumpCode)
  if (unitErrors.length > 0) {
    return { ok: false, message: unitErrors.join('；') }
  }
  if (!Number.isFinite(draft.current) || draft.current < 0) {
    return { ok: false, message: '运行电流这一格要填不小于 0 的数字（A）' }
  }
  if (!parseTime(draft.recordTime)) {
    return { ok: false, message: '记录时间这一格没填或时间格式不对' }
  }
  const unit = findUnit(station, pumpCode) as PumpUnit
  const over = draft.current > unit.ratedCurrent
  const id = nextId(RUN_KEY)
  const row: EntryRow = {
    id,
    status: '待开机',
    pending: true,
    // 电流登记即超标：先标成异常，等电流改回额定值以内再消。
    abnormal: over,
    运行编号: code,
    所属泵站: station,
    泵组编号: pumpCode,
    泵组名称: unit.pumpName,
    '运行电流(A)': draft.current,
    '额定电流(A)': unit.ratedCurrent,
    '出水流量(m³/h)': draft.flow.trim(),
    值班人: draft.operator.trim(),
    记录时间: draft.recordTime,
    开机时间: '',
    停机时间: '',
    运行时长: '',
    停机结论: '',
  }
  saveRows(RUN_KEY, [...rows, row])
  return {
    ok: true,
    id,
    message: over
      ? `已登记为待开机，但运行电流 ${draft.current}A 超过额定值 ${unit.ratedCurrent}A，已标出并挡住开机`
      : `运行单 ${code} 已登记，状态「待开机」`,
  }
}

// 待开机的记录允许改记电流（现场表计读数核实后纠正），超标态随之更新。
export function updateRunCurrent(id: number, current: number): ActionResult {
  const rows = listRows(RUN_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的泵组运行记录` }
  }
  const row = rows[index]
  if (String(row.status) !== '待开机') {
    return { ok: false, message: `运行单已${row.status}，运行电流不能再改` }
  }
  if (!Number.isFinite(current) || current < 0) {
    return { ok: false, message: '运行电流要填不小于 0 的数字（A）' }
  }
  const rated = Number(row['额定电流(A)'])
  const next = [...rows]
  next[index] = { ...row, '运行电流(A)': current, abnormal: current > rated }
  saveRows(RUN_KEY, next)
  return current > rated
    ? {
        ok: true,
        message: `运行电流已改记为 ${current}A，仍超过额定值 ${rated}A，继续挡住开机`,
      }
    : { ok: true, message: `运行电流已改记为 ${current}A，在额定值 ${rated}A 以内，可以提交开机` }
}

function findRun(id: number): { rows: EntryRow[]; index: number; row: EntryRow } | null {
  const rows = listRows(RUN_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  return index < 0 ? null : { rows, index, row: rows[index] }
}

// 提交开机：状态机只在「待开机」放行；同泵运行中挡第二条；超额定电流挡确认。
export function startRun(id: number, startTime: string): ActionResult {
  const found = findRun(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的泵组运行记录` }
  }
  const { rows, index, row } = found
  if (String(row.status) !== '待开机') {
    return {
      ok: false,
      message: `运行单 ${row['运行编号']} 当前是「${row.status}」，只有「待开机」能提交开机，不许跳着改`,
    }
  }
  const info = currentInfo(row)
  if (info?.overrun) {
    return {
      ok: false,
      message: `开机被挡住：运行电流 ${info.actual}A 超过该泵额定值 ${info.rated}A，超出 ${info.over}A（${info.percent}%）。请核实表计后改记电流，再提交开机。`,
    }
  }
  const station = String(row['所属泵站'])
  const pumpCode = String(row['泵组编号'])
  const running = rows.find(
    (item) =>
      Number(item.id) !== id &&
      String(item.status) === '运行中' &&
      String(item['所属泵站']) === station &&
      String(item['泵组编号']) === pumpCode,
  )
  if (running) {
    return {
      ok: false,
      message: `同一台泵 ${station}/${pumpCode} 已有运行中的记录 ${running['运行编号']}，不允许再开第二条`,
    }
  }
  const begin = parseTime(startTime)
  if (!begin) {
    return { ok: false, message: '开机时间没填或格式不对，无法提交开机' }
  }
  const next = [...rows]
  next[index] = {
    ...row,
    status: '运行中',
    pending: true,
    abnormal: false,
    开机时间: startTime,
  }
  saveRows(RUN_KEY, next)
  return { ok: true, message: `运行单 ${row['运行编号']} 已提交开机，状态「运行中」` }
}

function createMaintTodo(row: EntryRow, conclusion: string, fault: boolean): void {
  const maintRows = listRows(MAINT_KEY)
  const code = String(row['运行编号'])
  // 同一条运行单的停机待办只落一次，重复点停机不会在待修清单里堆重复。
  if (maintRows.some((item) => String(item['来源运行单']) === code)) {
    return
  }
  const id = nextId(MAINT_KEY)
  const todo: EntryRow = {
    id,
    status: '待开工',
    pending: true,
    abnormal: fault,
    检修编号: `JX-${String(id).padStart(4, '0')}`,
    所属泵站: String(row['所属泵站']),
    泵组编号: String(row['泵组编号']),
    检修类别: fault ? '故障检修' : '例行保养',
    检修班组: '待安排',
    计划工期: '待排期',
    完成日期: '',
    更换部件: '',
    来源运行单: code,
    待修结论: conclusion,
  }
  saveRows(MAINT_KEY, [...maintRows, todo])
}

type StopDraft = {
  stopTime: string
  conclusion: string
  fault: boolean
}

// 登记停机 / 上报故障：算这一段运行时长（跨零点按实际时间累加），结论落到检修待修清单。
export function stopRun(id: number, draft: StopDraft): ActionResult {
  const found = findRun(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的泵组运行记录` }
  }
  const { rows, index, row } = found
  if (String(row.status) !== '运行中') {
    return {
      ok: false,
      message: `运行单 ${row['运行编号']} 当前是「${row.status}」，只有「运行中」能登记停机`,
    }
  }
  const begin = parseTime(String(row['开机时间']))
  const finish = parseTime(draft.stopTime)
  if (!begin) {
    return { ok: false, message: '这条记录缺开机时间，没法算运行时长' }
  }
  if (!finish) {
    return { ok: false, message: '停机时间没填或格式不对' }
  }
  if (finish.getTime() < begin.getTime()) {
    return { ok: false, message: '停机时间早于开机时间，时间对不上，不能登记' }
  }
  const conclusion = draft.conclusion.trim()
  if (!conclusion) {
    return {
      ok: false,
      message: draft.fault ? '上报故障要写明故障现象（停机结论）' : '停机结论这一格要填，便于落到检修待修清单',
    }
  }
  const target = draft.fault ? '故障停机' : '已停机'
  const duration = formatDuration(String(row['开机时间']), draft.stopTime)
  const next = [...rows]
  next[index] = {
    ...row,
    status: target,
    pending: false,
    abnormal: draft.fault ? true : row.abnormal,
    停机时间: draft.stopTime,
    运行时长: duration,
    停机结论: conclusion,
  }
  saveRows(RUN_KEY, next)
  createMaintTodo(next[index], conclusion, draft.fault)
  return {
    ok: true,
    message: `运行单 ${row['运行编号']} 已${draft.fault ? '上报故障' : '登记停机'}，本段运行 ${duration}，检修待修清单已生成待办`,
  }
}

export type RunStats = {
  running: number
  waiting: number
  stopped: number
  fault: number
  overrun: number
}

export function runStats(rows: EntryRow[]): RunStats {
  return {
    running: rows.filter((row) => String(row.status) === '运行中').length,
    waiting: rows.filter((row) => String(row.status) === '待开机').length,
    stopped: rows.filter((row) => String(row.status) === '已停机').length,
    fault: rows.filter((row) => String(row.status) === '故障停机').length,
    overrun: rows.filter((row) => {
      const info = currentInfo(row)
      return Boolean(info?.overrun)
    }).length,
  }
}
