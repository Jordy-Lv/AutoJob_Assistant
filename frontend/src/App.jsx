import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import Layout from "@/components/layout/Layout/Layout";
import { AppProvider } from "@/context/AppContext";
import { ToastProvider } from "@/context/ToastContext";
import Inicio from "@/pages/Inicio/Inicio";
import BuscarOfertas from "@/pages/BuscarOfertas/BuscarOfertas";
import Ofertas from "@/pages/Ofertas/Ofertas";
import Analisis from "@/pages/Analisis/Analisis";
import Guardados from "@/pages/Guardados/Guardados";
import Documentos from "@/pages/Documentos/Documentos";
import Perfil from "@/pages/Perfil/Perfil";
import Historial from "@/pages/Historial/Historial";
import Configuracion from "@/pages/Configuracion/Configuracion";

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Inicio />} />
                <Route path="buscar" element={<BuscarOfertas />} />
                <Route path="ofertas" element={<Ofertas />} />
                <Route path="analisis" element={<Analisis />} />
                <Route path="guardados" element={<Guardados />} />
                <Route path="documentos" element={<Documentos />} />
                <Route path="perfil" element={<Perfil />} />
                <Route path="historial" element={<Historial />} />
                <Route path="configuracion" element={<Configuracion />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </ToastProvider>
    </AppProvider>
  );
}
