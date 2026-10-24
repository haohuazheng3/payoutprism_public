import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("app-store");

export default function Page() {
  return (
    <CalculatorPage slug="app-store">
      <Ui />
    </CalculatorPage>
  );
}
