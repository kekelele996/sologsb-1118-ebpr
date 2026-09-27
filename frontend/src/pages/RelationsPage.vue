<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Relation, RelationBasis, RelationStatus, RelationType } from '@/types'
import { RELATION_BASES, RELATION_STATUSES, RELATION_STATUS_TAGS, RELATION_TYPES } from '@/types'
import RelationGraph from '@/components/common/RelationGraph.vue'
import UnitPicker from '@/components/common/UnitPicker.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { checkRelationCycle, useRelationGraph } from '@/hooks/useRelationGraph'
import { relationStore } from '@/stores/relationStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { downloadCsv } from '@/utils/export'
import { uid } from '@/utils/id'

const relationState = useStore(relationStore)
const stratumState = useStore(stratumStore)
const trenchState = useStore(trenchStore)

const filterTrenchId = ref('')
const filterStatus = ref<RelationStatus | ''>('')
const activeId = ref<string | null>(null)
const editingId = ref<string | null>(null)

const form = reactive({
  unitAId: '',
  type: '叠压' as RelationType,
  unitBId: '',
  basis: '剖面观察' as RelationBasis,
  recorder: '',
  note: ''
})

const graphStrata = computed(() =>
  filterTrenchId.value
    ? stratumState.strata.filter((item) => item.trenchId === filterTrenchId.value)
    : stratumState.strata
)

/** 探方筛选后的关系（关系任一端单位属于该探方即命中） */
const trenchRelations = computed(() => {
  if (!filterTrenchId.value) return relationState.relations
  const unitIds = new Set(
    stratumState.strata.filter((item) => item.trenchId === filterTrenchId.value).map((item) => item.id)
  )
  return relationState.relations.filter((item) => unitIds.has(item.unitAId) || unitIds.has(item.unitBId))
})

/** 再按核对状态筛选，清单 / 关系图 / 导出共用 */
const filteredRelations = computed(() =>
  filterStatus.value
    ? trenchRelations.value.filter((item) => item.status === filterStatus.value)
    : trenchRelations.value
)

/** 当前探方范围内各状态条数 */
const statusCounts = computed(() => {
  const counts: Record<RelationStatus, number> = { 待核对: 0, 已确认: 0, 存疑: 0 }
  trenchRelations.value.forEach((item) => {
    counts[item.status] += 1
  })
  return counts
})

const { graph, highlighted, degreeOf } = useRelationGraph(graphStrata, filteredRelations, activeId)

const activeNode = computed(() => graph.value.nodes.find((node) => node.id === activeId.value) ?? null)
const directOut = computed(() => (activeId.value ? graph.value.adjacency.get(activeId.value) ?? [] : []))
const directIn = computed(() => (activeId.value ? graph.value.reverse.get(activeId.value) ?? [] : []))

watch(
  () => [graphStrata.value.length, form.unitAId, form.unitBId] as const,
  () => {
    const list = graphStrata.value
    if (list.length === 0) return
    if (!list.some((item) => item.id === form.unitAId)) form.unitAId = list[0].id
    if (!list.some((item) => item.id === form.unitBId)) form.unitBId = list[1]?.id ?? list[0].id
  },
  { immediate: true }
)

function unitLabel(stratumId: string): string {
  const stratum = stratumState.strata.find((item) => item.id === stratumId)
  if (!stratum) return '未知单位'
  const trench = trenchState.trenches.find((item) => item.id === stratum.trenchId)
  return `${stratum.code}（${trench ? `${trench.area}·${trench.code}` : '未知探方'} · ${stratum.type}）`
}

function resetForm(): void {
  editingId.value = null
  form.type = '叠压'
  form.basis = '剖面观察'
  form.recorder = ''
  form.note = ''
}

async function submit(): Promise<void> {
  if (!form.unitAId || !form.unitBId) {
    ElMessage.warning('请选择单位 A 与单位 B')
    return
  }
  if (form.unitAId === form.unitBId) {
    ElMessage.error('单位 A 与单位 B 不能相同')
    return
  }
  const others = relationState.relations.filter((item) => item.id !== editingId.value)
  if (checkRelationCycle(others, { unitAId: form.unitAId, unitBId: form.unitBId, type: form.type })) {
    ElMessage.error(
      `拒绝保存：${unitLabel(form.unitAId)} ${form.type} ${unitLabel(form.unitBId)} 会形成环路矛盾（层位关系不能自相闭合）`
    )
    return
  }
  const previous = editingId.value
    ? relationState.relations.find((item) => item.id === editingId.value)
    : undefined
  const row: Relation = {
    id: editingId.value ?? uid('rl'),
    unitAId: form.unitAId,
    type: form.type,
    unitBId: form.unitBId,
    basis: form.basis,
    recorder: form.recorder.trim(),
    note: form.note.trim(),
    // 关系内容一经改动即视为新的现场初判，需重新核对
    status: '待核对',
    reviewer: '',
    reviewDate: '',
    doubtReason: ''
  }
  await relationStore.getState().save(row)
  if (previous && previous.status !== '待核对') {
    ElMessage.warning(`已保存：${unitLabel(row.unitAId)} ${row.type} ${unitLabel(row.unitBId)}，原「${previous.status}」状态退回待核对`)
  } else {
    ElMessage.success(`已记录：${unitLabel(row.unitAId)} ${row.type} ${unitLabel(row.unitBId)}`)
  }
  resetForm()
}

function edit(relation: Relation): void {
  editingId.value = relation.id
  Object.assign(form, {
    unitAId: relation.unitAId,
    type: relation.type,
    unitBId: relation.unitBId,
    basis: relation.basis,
    recorder: relation.recorder,
    note: relation.note
  })
}

async function remove(relation: Relation): Promise<void> {
  await ElMessageBox.confirm(
    `确认删除关系「${unitLabel(relation.unitAId)} ${relation.type} ${unitLabel(relation.unitBId)}」？`,
    '删除确认',
    { type: 'warning' }
  )
  await relationStore.getState().remove(relation.id)
  ElMessage.success('关系已删除')
}

/* ---------- 核对状态登记 ---------- */

const statusDialogVisible = ref(false)
const statusMode = ref<'confirm' | 'doubt'>('confirm')
const statusTarget = ref<Relation | null>(null)
const statusForm = reactive({
  reviewer: '',
  reviewDate: '',
  doubtReason: ''
})

function openConfirm(relation: Relation): void {
  statusMode.value = 'confirm'
  statusTarget.value = relation
  statusForm.reviewer = relation.reviewer || relation.recorder
  statusForm.reviewDate = relation.reviewDate || new Date().toISOString().slice(0, 10)
  statusDialogVisible.value = true
}

function openDoubt(relation: Relation): void {
  statusMode.value = 'doubt'
  statusTarget.value = relation
  statusForm.doubtReason = relation.doubtReason
  statusDialogVisible.value = true
}

async function submitStatus(): Promise<void> {
  const target = statusTarget.value
  if (!target) return
  const label = `${unitLabel(target.unitAId)} ${target.type} ${unitLabel(target.unitBId)}`
  if (statusMode.value === 'confirm') {
    if (!statusForm.reviewer.trim() || !statusForm.reviewDate) {
      ElMessage.warning('确认时必须填写复核人与复核日期')
      return
    }
    await relationStore.getState().confirm(target.id, statusForm.reviewer.trim(), statusForm.reviewDate)
    ElMessage.success(`已确认：${label}（复核人 ${statusForm.reviewer.trim()}）`)
  } else {
    if (!statusForm.doubtReason.trim()) {
      ElMessage.warning('标为存疑时必须填写原因')
      return
    }
    await relationStore.getState().markDoubtful(target.id, statusForm.doubtReason.trim())
    ElMessage.success(`已标为存疑：${label}`)
  }
  statusDialogVisible.value = false
}

async function resetStatus(relation: Relation): Promise<void> {
  await relationStore.getState().resetStatus(relation.id)
  ElMessage.success(`已退回待核对：${unitLabel(relation.unitAId)} ${relation.type} ${unitLabel(relation.unitBId)}`)
}

/* ---------- 导出 ---------- */

function exportList(): void {
  downloadCsv(
    '层位关系清单.csv',
    filteredRelations.value.map((item) => ({
      unitA: unitLabel(item.unitAId),
      type: item.type,
      unitB: unitLabel(item.unitBId),
      basis: item.basis,
      recorder: item.recorder,
      status: item.status,
      reviewer: item.reviewer,
      reviewDate: item.reviewDate,
      doubtReason: item.doubtReason,
      note: item.note
    })) as unknown as Record<string, unknown>[],
    [
      { key: 'unitA', label: '单位 A' },
      { key: 'type', label: '关系' },
      { key: 'unitB', label: '单位 B' },
      { key: 'basis', label: '判定依据' },
      { key: 'recorder', label: '记录人' },
      { key: 'status', label: '核对状态' },
      { key: 'reviewer', label: '复核人' },
      { key: 'reviewDate', label: '复核日期' },
      { key: 'doubtReason', label: '存疑原因' },
      { key: 'note', label: '备注' }
    ]
  )
  ElMessage.success(`已导出 ${filteredRelations.value.length} 条层位关系`)
}

function selectNode(nodeId: string): void {
  activeId.value = activeId.value === nodeId ? null : nodeId
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">层位关系视图</h2>
        <p class="page-sub">
          现场初判先记为「待核对」，回驻地复核后确认（需复核人与日期）或标为存疑（需原因）；关系两端单位一旦改动，已确认关系自动退回待核对。
        </p>
      </div>
      <div class="head-ops">
        <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 130px">
          <el-option v-for="item in RELATION_STATUSES" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select v-model="filterTrenchId" placeholder="全部探方" clearable style="width: 190px">
          <el-option v-for="trench in trenchState.trenches" :key="trench.id" :label="`${trench.area} · ${trench.code}`" :value="trench.id" />
        </el-select>
        <el-button @click="exportList">
          <el-icon><Download /></el-icon>导出 CSV
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="graph.hasCycle"
      class="alert"
      type="error"
      :closable="false"
      show-icon
      :title="`检测到环路关系（矛盾）：${graph.cyclePath.map((id) => stratumState.strata.find((item) => item.id === id)?.code ?? id).join(' → ')} → ${stratumState.strata.find((item) => item.id === graph.cyclePath[0])?.code ?? ''}`"
    />
    <el-alert
      v-else
      class="alert"
      type="success"
      :closable="false"
      show-icon
      title="当前层位关系无环路矛盾"
    />

    <div class="layout">
      <el-card shadow="never" class="graph-card">
        <template #header>
          <div class="card-head">
            <span>层位关系有向图（{{ graph.nodes.length }} 节点 / {{ graph.edges.length }} 条边）</span>
            <span class="muted">
              <template v-if="activeNode">
                已选中 {{ activeNode.label }}：直接后继 {{ directOut.length }} 个、直接前驱 {{ directIn.length }} 个、关联度
                {{ degreeOf(activeNode.id) }}
              </template>
              <template v-else>边按核对状态着色，点击节点查看直接关系</template>
            </span>
          </div>
        </template>
        <RelationGraph
          :nodes="graph.nodes"
          :edges="graph.edges"
          :highlighted="highlighted"
          :active-id="activeId"
          :width="720"
          :height="420"
          @select="selectNode"
        />
      </el-card>

      <div class="side">
        <el-card shadow="never" class="form-card">
          <template #header>{{ editingId ? '编辑层位关系' : '新增层位关系' }}</template>
          <UnitPicker
            :trenches="trenchState.trenches"
            :strata="stratumState.strata"
            :trench-id="filterTrenchId"
            :model-value="form.unitAId"
            :show-depth-range="false"
            @update:model-value="(value: string) => (form.unitAId = value)"
          />
          <el-form label-width="76px" size="small" class="rel-form">
            <el-form-item label="关系类型">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="item in RELATION_TYPES" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
            <el-form-item label="单位 B">
              <el-select v-model="form.unitBId" filterable style="width: 100%">
                <el-option
                  v-for="item in graphStrata"
                  :key="item.id"
                  :label="`${item.code}（${item.type} · ${item.topDepth}–${item.bottomDepth} m）`"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="判定依据">
              <el-select v-model="form.basis" style="width: 100%">
                <el-option v-for="item in RELATION_BASES" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
            <el-form-item label="记录人">
              <el-input v-model="form.recorder" />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="form.note" type="textarea" :rows="2" placeholder="如 H12 开口于第②层下，打破 L02" />
            </el-form-item>
            <div class="actions">
              <el-button type="primary" size="small" @click="submit">保存关系</el-button>
              <el-button v-if="editingId" size="small" @click="resetForm">取消</el-button>
            </div>
            <p v-if="editingId" class="hint">保存后该关系将退回「待核对」，需重新复核确认。</p>
          </el-form>
        </el-card>

        <el-card shadow="never" class="list-card">
          <template #header>
            <div class="card-head">
              <span>关系清单（{{ filteredRelations.length }} / {{ relationState.relations.length }}）</span>
              <span class="counts">
                <el-tag
                  v-for="status in RELATION_STATUSES"
                  :key="status"
                  :type="RELATION_STATUS_TAGS[status]"
                  size="small"
                  effect="plain"
                >
                  {{ status }} {{ statusCounts[status] }}
                </el-tag>
              </span>
            </div>
          </template>
          <ul class="rel-list">
            <li v-for="relation in filteredRelations" :key="relation.id">
              <div class="rel-line">
                <span class="mono">{{ unitLabel(relation.unitAId) }}</span>
                <el-tag size="small" effect="dark" class="type">{{ relation.type }}</el-tag>
                <span class="mono">{{ unitLabel(relation.unitBId) }}</span>
                <el-tag :type="RELATION_STATUS_TAGS[relation.status]" size="small" effect="plain">
                  {{ relation.status }}
                </el-tag>
                <span class="ops">
                  <el-button link type="success" size="small" @click="openConfirm(relation)">确认</el-button>
                  <el-button link type="warning" size="small" @click="openDoubt(relation)">存疑</el-button>
                  <el-button v-if="relation.status !== '待核对'" link size="small" @click="resetStatus(relation)">
                    退回待核对
                  </el-button>
                  <el-button link type="primary" size="small" @click="edit(relation)">编辑</el-button>
                  <el-button link type="danger" size="small" @click="remove(relation)">删除</el-button>
                </span>
              </div>
              <div class="rel-sub muted">
                {{ relation.basis }} · {{ relation.recorder || '未填记录人' }}
                <template v-if="relation.status === '已确认'">
                  · 复核：{{ relation.reviewer }}（{{ relation.reviewDate }}）
                </template>
                <template v-if="relation.status === '存疑'"> · 存疑原因：{{ relation.doubtReason }} </template>
                <template v-if="relation.note"> · {{ relation.note }} </template>
              </div>
            </li>
            <li v-if="filteredRelations.length === 0" class="muted">暂无符合条件的层位关系</li>
          </ul>
        </el-card>
      </div>
    </div>

    <el-dialog
      v-model="statusDialogVisible"
      :title="statusMode === 'confirm' ? '确认层位关系' : '标记存疑'"
      width="460px"
    >
      <template v-if="statusTarget">
        <p class="dialog-rel mono">
          {{ unitLabel(statusTarget.unitAId) }} {{ statusTarget.type }} {{ unitLabel(statusTarget.unitBId) }}
        </p>
        <el-form v-if="statusMode === 'confirm'" label-width="80px">
          <el-form-item label="复核人" required>
            <el-input v-model="statusForm.reviewer" placeholder="填写复核人姓名" />
          </el-form-item>
          <el-form-item label="复核日期" required>
            <el-date-picker v-model="statusForm.reviewDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-form>
        <el-form v-else label-width="80px">
          <el-form-item label="存疑原因" required>
            <el-input
              v-model="statusForm.doubtReason"
              type="textarea"
              :rows="3"
              placeholder="如 剖面被扰坑破坏，界面不清，需重新刮面确认"
            />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="statusDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitStatus">
          {{ statusMode === 'confirm' ? '确认无误' : '标为存疑' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.alert {
  margin-bottom: 14px;
}
.head-ops {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.layout {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.graph-card {
  flex: 1 1 560px;
  border-radius: 12px;
}
.side {
  flex: 1 1 320px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-card,
.list-card {
  border-radius: 12px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.counts {
  display: inline-flex;
  gap: 6px;
}
.rel-form {
  margin-top: 10px;
}
.actions {
  display: flex;
  gap: 8px;
  padding-left: 76px;
}
.hint {
  margin: 6px 0 0;
  padding-left: 76px;
  font-size: 12px;
  color: #b8860b;
}
.rel-list {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
}
.rel-list li {
  padding: 6px 0;
  border-bottom: 1px dotted #e6ded0;
}
.rel-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.rel-sub {
  margin-top: 2px;
  padding-left: 2px;
}
.type {
  margin: 0 2px;
}
.ops {
  margin-left: auto;
  white-space: nowrap;
}
.dialog-rel {
  margin: 0 0 14px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f4ee;
  font-size: 13px;
}
</style>
