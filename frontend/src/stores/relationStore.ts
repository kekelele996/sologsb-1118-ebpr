import { createStore } from 'zustand/vanilla'
import type { Relation } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface RelationState {
  relations: Relation[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 保存前由页面做环路检测，store 只负责写入 */
  save: (relation: Relation) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByStratum: (stratumId: string) => Promise<void>
  /** 确认：必须记录复核人与复核日期 */
  confirm: (id: string, reviewer: string, reviewDate: string) => Promise<void>
  /** 标为存疑：必须填写原因 */
  markDoubtful: (id: string, reason: string) => Promise<void>
  /** 退回待核对（清空复核与存疑信息） */
  resetStatus: (id: string) => Promise<void>
  /** 地层单位保存后，把涉及它的「已确认」关系退回待核对，返回退回条数 */
  invalidateByStratum: (stratumId: string) => Promise<number>
}

export const relationStore = createStore<RelationState>((set, get) => {
  /** 按 id 局部更新一条关系并重新水合 */
  const patch = async (id: string, changes: Partial<Relation>): Promise<void> => {
    const current = get().relations.find((item) => item.id === id)
    if (!current) return
    await syncPut<Relation>(db.relations, { ...current, ...changes })
    await get().hydrate()
  }

  return {
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
    confirm: async (id, reviewer, reviewDate) => {
      await patch(id, { status: '已确认', reviewer, reviewDate, doubtReason: '' })
    },
    markDoubtful: async (id, reason) => {
      await patch(id, { status: '存疑', doubtReason: reason, reviewer: '', reviewDate: '' })
    },
    resetStatus: async (id) => {
      await patch(id, { status: '待核对', reviewer: '', reviewDate: '', doubtReason: '' })
    },
    invalidateByStratum: async (stratumId) => {
      const targets = get().relations.filter(
        (item) => item.status === '已确认' && (item.unitAId === stratumId || item.unitBId === stratumId)
      )
      await Promise.all(
        targets.map((item) =>
          syncPut<Relation>(db.relations, { ...item, status: '待核对', reviewer: '', reviewDate: '' })
        )
      )
      if (targets.length > 0) {
        await get().hydrate()
      }
      return targets.length
    }
  }
})
