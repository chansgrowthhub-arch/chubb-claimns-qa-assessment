import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemeName = 'default' | 'corporate' | 'warm';

interface ThemeStore {
  theme: ThemeName;
  isDark: boolean;
  setTheme: (theme: ThemeName) => void;
  toggleDark: () => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'default',
      isDark: false,

      setTheme: (theme) => set({ theme }),

      toggleDark: () => set((state) => ({ isDark: !state.isDark })),
    }),
    {
      name: 'theme-storage',
      // Shipped tests specify localStorage (theme should survive new tabs/sessions);
      // implementation used sessionStorage, silently resetting user preference.
      storage: createJSONStorage(() => localStorage),
    }
  )
);
