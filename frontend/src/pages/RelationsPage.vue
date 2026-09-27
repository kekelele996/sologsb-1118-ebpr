<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Relation, RelationBasis, RelationStatus, RelationType } from '@/types'
import { RELATION_BASES, RELATION_STATUSES, RELATION_TYPES, relationStatusTagType } from '@/types'
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

const reviewDialogVisible = ref(false)
const reviewMode = ref<'已确认' | '存疑'>('已确认')
const reviewTarget = ref<Relation | null>(null)
const reviewForm = reactive({
  reviewer: '',
  reviewDate: new Date().toISOString().slice(0, 10),
  doubtReason: ''
})

const graphStrata = computed(() =>
  filterTrenchId.value
    ? stratumState.strata.filter((item) => item.trenchId === filterTrenchId.value)
    : stratumState.strata
)

/** 探方 + 状态双重筛选后的关系，清单、关系图与导出共用 */
const visibleRelations = computed(() =>
  relationState.relations.filter((item) => {
    if (filterStatus.value && item.status !== filterStatus.value) return false
    if (filterTrenchId.value) {
      const unitIds = graphStrata.value.map((unit) => unit.id)
      if (!unitIds.includes(item.unitAId) && !unitIds.includes(item.unitBId)) return false
    }
    return true
  })
)

/** 各状态条数（不受筛选影响，用于汇总标签） */
const statusCounts = computed(() =>
  RELATION_STATUSES.map((status) => ({
    status,
    count: relationState.relations.filter((item) => item.status === status).length
  }))
)

const { graph, highlighted, degreeOf } = useRelationGraph(
  graphStrata,
  visibleRelations,
  activeId
)

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
  // 新增与编辑保存后一律回到「待核对」，需重新复核确认
  const row: Relation = {
    id: editingId.value ?? uid('rl'),
    unitAId: form.unitAId,
    type: form.type,
    unitBId: form.unitBId,
    basis: form.basis,
    recorder: form.recorder.trim(),
    note: form.note.trim(),
    status: '待核对',
    reviewer: '',
    reviewDate: '',
    doubtReason: ''
  }
  await relationStore.getState().save(row)
  ElMessage.success(`已记录：${unitLabel(row.unitAId)} ${row.type} ${unitLabel(row.unitBId)}（待核对）`)
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

function openReview(relation: Relation, mode: '已确认' | '存疑'): void {
  reviewTarget.value = relation
  reviewMode.value = mode
  reviewForm.reviewer = mode === '已确认' ? relation.reviewer : ''
  reviewForm.reviewDate = relation.reviewDate || new Date().toISOString().slice(0, 10)
  reviewForm.doubtReason = mode === '存疑' ? relation.doubtReason : ''
  reviewDialogVisible.value = true
}

async function submitReview(): Promise<void> {
  const target = reviewTarget.value
  if (!target) return
  if (reviewMode.value === '已确认') {
    if (!reviewForm.reviewer.trim()) {
      ElMessage.warning('确认时请填写复核人')
      return
    }
    if (!reviewForm.reviewDate) {
      ElMessage.warning('确认时请填写复核日期')
      return
    }
  } else if (!reviewForm.doubtReason.trim()) {
    ElMessage.warning('标记存疑时请填写存疑原因')
    return
  }
  await relationStore.getState().review(target.id, reviewMode.value, {
    reviewer: reviewForm.reviewer.trim(),
    reviewDate: reviewForm.reviewDate,
    doubtReason: reviewForm.doubtReason.trim()
  })
  reviewDialogVisible.value = false
  ElMessage.success(
    reviewMode.value === '已确认'
      ? `已确认：${unitLabel(target.unitAId)} ${target.type} ${unitLabel(target.unitBId)}`
      : `已标记存疑：${unitLabel(target.unitAId)} ${target.type} ${unitLabel(target.unitBId)}`
  )
}

function exportList(): void {
  if (visibleRelations.value.length === 0) {
    ElMessage.warning('当前筛选条件下没有可导出的关系')
    return
  }
  downloadCsv(
    '层位关系清单.csv',
    visibleRelations.value.map((item) => ({
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
      { key: 'type', label: '关系类型' },
      { key: 'unitB', label: '单位 B' },
      { key: 'basis', label: '判定依据' },
      { key: 'recorder', label: '记录人' },
      { key: 'status', label: '复核状态' },
      { key: 'reviewer', label: '复核人' },
      { key: 'reviewDate', label: '复核日期' },
      { key: 'doubtReason', label: '存疑原因' },
      { key: 'note', label: '备注' }
    ]
  )
  ElMessage.success(`已按当前筛选导出 ${visibleRelations.value.length} 条层位关系`)
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
          现场初判的关系先记为「待核对」，回驻地复核后确认（填复核人与日期）或存疑（填原因）；关系两端任一单位保存后，已确认关系自动退回待核对。
        </p>
      </div>
      <div class="head-actions">
        <el-select v-model="filterTrenchId" placeholder="全部探方" clearable style="width: 170px">
          <el-option v-for="trench in trenchState.trenches" :key="trench.id" :label="`${trench.area} · ${trench.code}`" :value="trench.id" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 130px">
          <el-option v-for="status in RELATION_STATUSES" :key="status" :label="status" :value="status" />
        </el-select>
        <el-button @click="exportList">导出清单</el-button>
      </div>
    </div>

    <div class="status-bar">
      <el-tag
        v-for="item in statusCounts"
        :key="item.status"
        :type="relationStatusTagType(item.status)"
        :effect="filterStatus === item.status ? 'dark' : 'plain'"
        class="status-tag"
        @click="filterStatus = filterStatus === item.status ? '' : item.status"
      >
        {{ item.status }} {{ item.count }}
      </el-tag>
      <span class="muted">点击状态标签可快速筛选；清单、关系图与导出均按当前筛选生效</span>
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
              <template v-else>点击节点查看直接关系</template>
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
            <p v-if="editingId" class="warn">保存后该关系将退回「待核对」，需重新复核确认</p>
            <div class="actions">
              <el-button type="primary" size="small" @click="submit">保存关系</el-button>
              <el-button v-if="editingId" size="small" @click="resetForm">取消</el-button>
            </div>
          </el-form>
        </el-card>

        <el-card shadow="never" class="list-card">
          <template #header>关系清单（{{ visibleRelations.length }} / {{ relationState.relations.length }}）</template>
          <ul class="rel-list">
            <li v-for="relation in visibleRelations" :key="relation.id">
              <div class="rel-line">
                <el-tag :type="relationStatusTagType(relation.status)" size="small" effect="dark" class="status">
                  {{ relation.status }}
                </el-tag>
                <span class="mono">{{ unitLabel(relation.unitAId) }}</span>
                <el-tag size="small" effect="dark" class="type">{{ relation.type }}</el-tag>
                <span class="mono">{{ unitLabel(relation.unitBId) }}</span>
                <span class="ops">
                  <el-button link type="success" size="small" @click="openReview(relation, '已确认')">确认</el-button>
                  <el-button link type="warning" size="small" @click="openReview(relation, '存疑')">存疑</el-button>
                  <el-button link type="primary" size="small" @click="edit(relation)">编辑</el-button>
                  <el-button link type="danger" size="small" @click="remove(relation)">删除</el-button>
                </span>
              </div>
              <div class="rel-meta">
                <span>{{ relation.basis }} · {{ relation.recorder || '未填记录人' }}</span>
                <span v-if="relation.status === '已确认'">复核：{{ relation.reviewer }} @ {{ relation.reviewDate }}</span>
                <span v-else-if="relation.status === '存疑'" class="doubt">存疑原因：{{ relation.doubtReason }}</span>
                <span v-else>尚未复核</span>
                <span v-if="relation.note" class="muted">备注：{{ relation.note }}</span>
              </div>
            </li>
            <li v-if="visibleRelations.length === 0" class="muted">当前筛选条件下暂无层位关系</li>
          </ul>
        </el-card>
      </div>
    </div>

    <el-dialog
      v-model="reviewDialogVisible"
      :title="reviewMode === '已确认' ? '复核确认层位关系' : '标记存疑'"
      width="480px"
    >
      <p v-if="reviewTarget" class="review-target">
        {{ unitLabel(reviewTarget.unitAId) }} {{ reviewTarget.type }} {{ unitLabel(reviewTarget.unitBId) }}
      </p>
      <el-form label-width="90px">
        <template v-if="reviewMode === '已确认'">
          <el-form-item label="复核人" required>
            <el-input v-model="reviewForm.reviewer" placeholder="填写复核人姓名" />
          </el-form-item>
          <el-form-item label="复核日期" required>
            <el-date-picker v-model="reviewForm.reviewDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </template>
        <el-form-item v-else label="存疑原因" required>
          <el-input
            v-model="reviewForm.doubtReason"
            type="textarea"
            :rows="3"
            placeholder="如 剖面被扰坑破坏，打破关系需补照核对"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewDialogVisible = false">取消</el-button>
        <el-button :type="reviewMode === '已确认' ? 'success' : 'warning'" @click="submitReview">
          {{ reviewMode === '已确认' ? '确认无误' : '标记存疑' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.alert {
  margin-bottom: 14px;
}
.head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.status-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 12px;
}
.status-tag {
  cursor: pointer;
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
.rel-form {
  margin-top: 10px;
}
.warn {
  margin: 0 0 8px 76px;
  color: #c0392b;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 8px;
  padding-left: 76px;
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
.rel-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 3px;
  padding-left: 2px;
  color: #8a8073;
}
.rel-meta .doubt {
  color: #c0392b;
}
.status {
  flex-shrink: 0;
}
.type {
  margin: 0 2px;
}
.ops {
  margin-left: auto;
  white-space: nowrap;
}
.review-target {
  margin: 0 0 12px;
  font-weight: 600;
}
</style>
