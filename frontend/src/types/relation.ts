/** 关系类型 */
export const RELATION_TYPES = ['叠压', '打破', '共存'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

/** 判定依据 */
export const RELATION_BASES = ['剖面观察', '平面观察'] as const
export type RelationBasis = (typeof RELATION_BASES)[number]

/** 核对状态：现场初判一律先记为「待核对」 */
export const RELATION_STATUSES = ['待核对', '已确认', '存疑'] as const
export type RelationStatus = (typeof RELATION_STATUSES)[number]

/** 状态对应的标签样式 */
export const RELATION_STATUS_TAGS: Record<RelationStatus, 'warning' | 'success' | 'danger'> = {
  待核对: 'warning',
  已确认: 'success',
  存疑: 'danger'
}

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
  /** 核对状态 */
  status: RelationStatus
  /** 复核人（状态为「已确认」时填写） */
  reviewer: string
  /** 复核日期（状态为「已确认」时填写） */
  reviewDate: string
  /** 存疑原因（状态为「存疑」时填写） */
  doubtReason: string
}
