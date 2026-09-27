/** 关系类型 */
export const RELATION_TYPES = ['叠压', '打破', '共存'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

/** 判定依据 */
export const RELATION_BASES = ['剖面观察', '平面观察'] as const
export type RelationBasis = (typeof RELATION_BASES)[number]

/** 复核状态：现场初判的关系默认待核对，回驻地复核后确认或存疑 */
export const RELATION_STATUSES = ['待核对', '已确认', '存疑'] as const
export type RelationStatus = (typeof RELATION_STATUSES)[number]

/** Relation 层位关系 */
export interface Relation {
  id: string
  /** 单位 A */
  unitAId: string
  type: RelationType
  /** 单位 B */
  unitBId: string
  basis: RelationBasis
  recorder: string
  note: string
  /** 复核状态 */
  status: RelationStatus
  /** 复核人（确认时必填） */
  reviewer: string
  /** 复核日期（确认时必填） */
  reviewDate: string
  /** 存疑原因（标记存疑时必填） */
  doubtReason: string
}

/** 状态对应的标签样式 */
export function relationStatusTagType(status: RelationStatus): 'warning' | 'success' | 'danger' {
  if (status === '已确认') return 'success'
  if (status === '存疑') return 'danger'
  return 'warning'
}
