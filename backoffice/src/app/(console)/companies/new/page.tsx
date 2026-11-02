import { PageHeader } from "@/components/ui";
import { NewCompanyForm } from "./new-company-form";

export const metadata = { title: "Nova clínica" };

export default function NewCompanyPage() {
  return (
    <>
      <PageHeader
        title="Nova clínica"
        description="Cria a clínica e a conta do administrador dela. O administrador entra na plataforma com este e-mail e senha e pode convidar o restante da equipe."
      />
      <NewCompanyForm />
    </>
  );
}
