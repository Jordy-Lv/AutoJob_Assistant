import { useContext } from "react";
import { AppContext } from "@/context/AppContext";

export function useTheme() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useTheme debe usarse dentro de AppProvider");
  }
  return {
    theme: context.theme,
    toggleTheme: context.toggleTheme,
    setTheme: context.setTheme,
  };
}
