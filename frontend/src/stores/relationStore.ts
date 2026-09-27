import { createStore } from 'zustand/vanilla'
import type { Relation } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface RelationReviewPatch {
  reviewer: string
  reviewDate: string
  doubtReason: string
}

export interface RelationState {
  relations: Relation[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 保存前由页面做环路检测，store 只负责写入 */
  save: (relation: Relation) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByStratum: (stratumId: string) => Promise<void>
  /** 复核：确认（填复核人与日期）或存疑（填原因） */
  review: (id: string, status: '已确认' | '存疑', patch: RelationReviewPatch) => Promise<void>
  /** 地层单位保存后，其参与的「已确认」关系退回待核对；返回退回条数 */
  resetConfirmedByStrata: (stratumIds: string[]) => Promise<number>
}

export const relationStore = createStore<RelationState>((set, get) => ({
  relations: [],
  loaded: false,
  hydrate: async () => {
    const relations = await syncAll<Relation>(db.relations)
    relations.sort((a, b) => a.id.localeCompare(b.id))
    set({ relations, loaded: true })
  },
  save: async (relation) => {
    await syncPut<Relation>(db.relations, relation)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<Relation>(db.relations, id)
    await get().hydrate()
  },
  removeByStratum: async (stratumId) => {
    const targets = get().relations.filter((item) => item.unitAId === stratumId || item.unitBId === stratumId)
    await Promise.all(targets.map((item) => syncDelete<Relation>(db.relations, item.id)))
    await get().hydrate()
  },
  review: async (id, status, patch) => {
    const target = get().relations.find((item) => item.id === id)
    if (!target) return
    const next: Relation =
      status === '已确认'
        ? { ...target, status, reviewer: patch.reviewer, reviewDate: patch.reviewDate, doubtReason: '' }
        : { ...target, status, doubtReason: patch.doubtReason, reviewer: '', reviewDate: '' }
    await syncPut<Relation>(db.relations, next)
    await get().hydrate()
  },
  resetConfirmedByStrata: async (stratumIds) => {
    if (stratumIds.length === 0) return 0
    const targets = get().relations.filter(
      (item) =>
        item.status === '已确认' && (stratumIds.includes(item.unitAId) || stratumIds.includes(item.unitBId))
    )
    await Promise.all(
      targets.map((item) =>
        syncPut<Relation>(db.relations, { ...item, status: '待核对', reviewer: '', reviewDate: '' })
      )
    )
    if (targets.length > 0) await get().hydrate()
    return targets.length
  }
}))
