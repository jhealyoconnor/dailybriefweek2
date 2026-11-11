import { useEffect, useSyncExternalStore } from 'react'
import { getSnapshot, loadGis, signIn, signOut, subscribe } from './googleAuth'

export function useGoogleAuth() {
  const state = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    void loadGis()
  }, [])

  return { ...state, signIn, signOut }
}
