import { createContext } from "react";

export const AppContext = createContext(null);

export function useAppContextValue({ jobs, setJobs, profile, setProfile, documents, setDocuments, toast, showToast, theme, toggleTheme }) {
  return { jobs, setJobs, profile, setProfile, documents, setDocuments, toast, showToast, theme, toggleTheme };
}
