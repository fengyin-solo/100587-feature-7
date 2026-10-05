// 冒烟脚本：验证泵组开机/停机规矩（状态机、同泵不重开、超额定电流拦截、
// 三格联合查询、跨零点时长、停机落检修待办）。仅测试用，不进应用构建。
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const result = await build({
  entryPoints: ['src/api/pump-run-service.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})
writeFileSync('/tmp/pump-run-bundle.mjs', result.outputFiles[0].text)

// localStorage 桩：首次读取返回 null，让数据层落回播种数据。
const memory = {}
const ls = {
  getItem: (key) => (key in memory ? memory[key] : null),
  setItem: (key, value) => {
    memory[key] = String(value)
  },
  removeItem: (key) => {
    delete memory[key]
  },
}
globalThis.localStorage = ls
globalThis.window = { localStorage: ls }

const svc = await import('file:///tmp/pump-run-bundle.mjs')

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    console.log(`  ❌ ${name} ${detail}`)
  }
}

// 1. 跳级被打回：待开机直接登记停机不行；已停机再操作也不行
let r = svc.stopRun(1, { stopTime: '2026-10-05 09:00', conclusion: '试', fault: false })
check('待开机直接停机（跳级）被打回', !r.ok && r.message.includes('只有「运行中」'), r.message)

// 2. 超额定电流挡住开机：YX-0002 登记电流 132 > 额定 120
r = svc.startRun(2, '2026-10-05 08:20')
check('超额定电流开机被挡住并写明超了多少', !r.ok && r.message.includes('超出 12A（10%）'), r.message)

// 3. 改记回额定值以内后可以开机
r = svc.updateRunCurrent(2, 118)
check('改记电流到额定值以内放行', r.ok && r.message.includes('可以提交开机'), r.message)

// 4. 正常开机
r = svc.startRun(1, '2026-10-05 08:20')
check('待开机记录可提交开机', r.ok, r.message)

// 5. 同一台泵运行中不允许再开第二条
r = svc.createRun({
  code: 'YX-T1',
  station: '滨江一站',
  pumpCode: 'PUMP-101',
  current: 100,
  flow: '0',
  operator: '测试',
  recordTime: '2026-10-05 08:25',
})
check('同泵第二条记录可先登记待开机', r.ok, r.message)
const t1Id = r.id
r = svc.startRun(t1Id, '2026-10-05 08:26')
check('同一台泵运行中再开第二条被挡住', !r.ok && r.message.includes('不允许再开第二条'), r.message)

// 6. 三格联合查询：编号对、泵站错，要指出是所属泵站那格
let lookup = svc.lookupRun('YX-0003', '滨江一站', 'PUMP-201')
check('编号对、泵站错 → 指出所属泵站格没对上',
  lookup.row === null && lookup.mismatches.some((m) => m.includes('所属泵站这一格没对上')),
  JSON.stringify(lookup.mismatches))

// 7. 编号根本不存在 + 泵站/泵组对得上，要提示编号格错并给出最近运行单
lookup = svc.lookupRun('YX-9999', '河西立交泵站', 'PUMP-201')
check('编号不存在 → 指出运行编号格，并给出该泵已有运行单',
  lookup.row === null
  && lookup.mismatches.some((m) => m.includes('运行编号'))
  && lookup.mismatches.some((m) => m.includes('YX-0003')),
  JSON.stringify(lookup.mismatches))

// 8. 编号存在但泵站格填错（台账里也没这个站）
lookup = svc.lookupRun('YX-0001', '火星泵站', 'PUMP-101')
check('编号在、所属泵站格填错 → 指出所属泵站格没对上',
  lookup.row === null && lookup.mismatches.some((m) => m.startsWith('所属泵站这一格没对上')),
  JSON.stringify(lookup.mismatches))

// 9. 编号存在但泵组格填错（该编号实际挂在别泵）
lookup = svc.lookupRun('YX-0001', '滨江一站', 'PUMP-201')
check('编号在、泵组编号格填错 → 指出泵组编号格没对上并给出实际值',
  lookup.row === null
  && lookup.mismatches.some((m) => m.startsWith('泵组编号这一格没对上'))
  && lookup.mismatches.some((m) => m.includes('PUMP-101')),
  JSON.stringify(lookup.mismatches))

// 9b. 编号不存在、泵站真实但泵组不在其名下 → 台账级提示
lookup = svc.lookupRun('YX-9999', '滨江一站', 'PUMP-201')
check('编号不存在 + 泵组挂在别站 → 提示泵组不在该泵站名下',
  lookup.row === null
  && lookup.mismatches.some((m) => m.includes('挂在') && m.includes('河西立交泵站')),
  JSON.stringify(lookup.mismatches))

// 10. 三格全对
lookup = svc.lookupRun('YX-0003', '河西立交泵站', 'PUMP-201')
check('三格全对 → 命中记录', lookup.row !== null && lookup.row.status === '运行中')

// 11. 登记时就超电流：标异常但允许登记（挡住的是开机确认）
r = svc.createRun({
  code: 'YX-T2',
  station: '滨江一站',
  pumpCode: 'PUMP-103',
  current: 200,
  flow: '0',
  operator: '测试',
  recordTime: '2026-10-05 08:30',
})
check('登记时超电流：允许登记但提示挡住开机', r.ok && r.message.includes('挡住开机'), r.message)
r = svc.startRun(r.id, '2026-10-05 08:31')
check('超标待开机记录的开机确认仍被挡住', !r.ok && r.message.includes('开机被挡住'), r.message)

// 12. 跨零点时长
const dur = svc.formatDuration('2026-10-04 22:10', '2026-10-05 02:05')
check('跨零点时长按实际时间累加 = 3小时55分钟', dur === '3小时55分钟', dur)

// 13. 停机：算时长 + 落检修待办，且不重复落
const before = JSON.parse(memory['drainage-pump:entries:v2'])
const maintBefore = before.pumpmaint.length
r = svc.stopRun(1, { stopTime: '2026-10-05 23:40', conclusion: '正常停机，例行检查叶轮。', fault: false })
check('登记停机成功并算出时长', r.ok && r.message.includes('检修待修清单已生成待办'), r.message)
let after = JSON.parse(memory['drainage-pump:entries:v2'])
check('检修待修清单新增 1 条待开工待办',
  after.pumpmaint.length === maintBefore + 1
  && after.pumpmaint.at(-1).status === '待开工'
  && after.pumpmaint.at(-1).来源运行单 === 'YX-0001'
  && after.pumpmaint.at(-1).待修结论.includes('例行检查叶轮'),
  `before=${maintBefore} after=${after.pumpmaint.length}`)
const runRow = after.pumprun.find((x) => x.id === 1)
check('运行记录写上运行时长（跨零点 2026-10-05 08:20 → 23:40 = 15小时20分钟）',
  runRow['运行时长'] === '15小时20分钟', runRow['运行时长'])

// 已停机是终态：再来一次动作直接无效（服务层 stopRun 也挡）
r = svc.stopRun(1, { stopTime: '2026-10-05 23:50', conclusion: '重复', fault: false })
check('已停机后重复停机被挡、待办不重复',
  !r.ok && JSON.parse(memory['drainage-pump:entries:v2']).pumpmaint.length === after.pumpmaint.length,
  r.message)

// 14. 故障停机：异常 + 故障检修待办
r = svc.stopRun(3, { stopTime: '2026-10-05 09:10', conclusion: '轴承异响跳闸，需更换。', fault: true })
check('运行中可上报故障停机', r.ok, r.message)
after = JSON.parse(memory['drainage-pump:entries:v2'])
const faultTodo = after.pumpmaint.find((m) => m.来源运行单 === 'YX-0003')
check('故障停机生成「故障检修」待办且标异常',
  faultTodo && faultTodo.检修类别 === '故障检修' && faultTodo.abnormal === true,
  JSON.stringify(faultTodo))
const faultRun = after.pumprun.find((x) => x.id === 3)
check('运行单状态为故障停机、pending 收尾',
  faultRun.status === '故障停机' && faultRun.pending === false && faultRun.abnormal === true,
  JSON.stringify({ status: faultRun.status, pending: faultRun.pending }))

// 15. 停机时间早于开机时间：101 停机后 YX-T1 可以开机，再用倒置时间停机
r = svc.startRun(t1Id, '2026-10-05 10:00')
check('占用解除后同泵可开下一条', r.ok, r.message)
r = svc.stopRun(t1Id, { stopTime: '2026-10-05 09:00', conclusion: '时间倒置', fault: false })
check('停机时间早于开机时间被挡住', !r.ok && r.message.includes('停机时间早于开机时间'), r.message)

// 16. 运行编号重复开单
r = svc.createRun({
  code: 'YX-0001',
  station: '滨江一站',
  pumpCode: 'PUMP-101',
  current: 100,
  flow: '',
  operator: '',
  recordTime: '2026-10-05 10:00',
})
check('运行编号重复被挡', !r.ok && r.message.includes('已经登记过'), r.message)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
