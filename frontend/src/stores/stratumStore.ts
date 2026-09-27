import { createStore } from 'zustand/vanilla'
import type { Stratum, UnitType } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { relationStore } from '@/stores/relationStore'

export interface StratumState {
  strata: Stratum[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 保存后联动：该单位参与的「已确认」层位关系退回待核对，返回退回条数 */
  save: (stratum: Stratum) => Promise<number>
  remove: (id: string) => Promise<void>
  /** 批量调整类型同样触发已确认关系退回，返回退回条数 */
  bulkSetType: (ids: string[], type: UnitType) => Promise<number>
}

export const stratumStore = createStore<StratumState>((set, get) => ({
  strata: [],
  loaded: false,
  hydrate: async () => {
    const strata = await syncAll<Stratum>(db.strata)
    strata.sort((a, b) => (a.topDepth === b.topDepth ? a.code.localeCompare(b.code, 'zh-Hans-CN') : a.topDepth - b.topDepth))
    set({ strata, loaded: true })
  },
  save: async (stratum) => {
    await syncPut<Stratum>(db.strata, stratum)
    await get().hydrate()
    return relationStore.getState().resetConfirmedByStrata([stratum.id])
  },
  remove: async (id) => {
    await syncDelete<Stratum>(db.strata, id)
    await get().hydrate()
  },
  bulkSetType: async (ids, type) => {
    const targets = get().strata.filter((item) => ids.includes(item.id))
    await Promise.all(targets.map((item) => syncPut<Stratum>(db.strata, { ...item, type })))
    await get().hydrate()
    return relationStore.getState().resetConfirmedByStrata(ids)
  }
}))
