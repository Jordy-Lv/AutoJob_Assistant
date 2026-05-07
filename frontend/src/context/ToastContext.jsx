import { createContext, useCallback, useMemo, useState } from "react";
import Toast from "@/components/ui/Toast/Toast";

export const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((message, type = "success", options = {}) => {
    const id = crypto.randomUUID();
    const toast = { id, message, type, timeout: options.timeout ?? 4500 };
    setToasts((current) => [...current, toast]);
    if (toast.timeout > 0) {
      window.setTimeout(() => removeToast(id), toast.timeout);
    }
    return id;
  }, [removeToast]);

  const value = useMemo(
    () => ({
      toasts,
      showToast: pushToast,
      dismissToast: removeToast,
      success: (message, options) => pushToast(message, "success", options),
      error: (message, options) => pushToast(message, "error", options),
      info: (message, options) => pushToast(message, "info", options),
      warning: (message, options) => pushToast(message, "warning", options),
    }),
    [toasts, pushToast, removeToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}
