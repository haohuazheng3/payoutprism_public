import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("poshmark");

export default function Page() {
  return (
    <CalculatorPage slug="poshmark">
      <Ui />
    </CalculatorPage>
  );
}
