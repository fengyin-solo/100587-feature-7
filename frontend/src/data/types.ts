/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 状态机：键为当前状态，值为从该状态允许执行的动作；不配置时沿用通用流转。
  transitions?: Record<string, string[]>
  // 终态列表：进入终态后 pending 置 false，且不再允许任何动作。
  finalStatuses?: string[]
}

// 泵组档案：运行记录里的额定电流、泵站与泵组编号都以这份台账为准。
export type PumpUnit = {
  station: string
  pumpCode: string
  pumpName: string
  ratedCurrent: number
}

// 运行编号 + 所属泵站 + 泵组编号三格联合查询的结果。
export type RunLookupResult = {
  row: EntryRow | null
  // 查不到时逐格说明哪一格没对上，方便值班人照格子改。
  mismatches: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
