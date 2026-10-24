import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("gofundme");

export default function Page() {
  return (
    <CalculatorPage slug="gofundme">
      <Ui />
    </CalculatorPage>
  );
}
