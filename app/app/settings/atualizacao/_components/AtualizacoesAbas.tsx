"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";

import { NovidadesPanel } from "./NovidadesPanel";
import { UpdateCenterPanel } from "./UpdateCenterPanel";
import { UpdatePanel } from "./UpdatePanel";

// Uma aba por assunto: o que chegou (padrão) × atualizar o sistema.
export function AtualizacoesAbas() {
  const t = useT();
  return (
    <Tabs defaultValue="novidades" className="mx-auto w-full max-w-5xl">
      <TabsList className="mb-4">
        <TabsTrigger value="novidades">{t("O que chegou")}</TabsTrigger>
        <TabsTrigger value="sistema">{t("Atualizar o sistema")}</TabsTrigger>
      </TabsList>
      <TabsContent value="novidades">
        <NovidadesPanel />
      </TabsContent>
      <TabsContent value="sistema">
        <UpdateCenterPanel />
        <UpdatePanel />
      </TabsContent>
    </Tabs>
  );
}
