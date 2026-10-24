import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("offerup");

export default function Page() {
  return (
    <CalculatorPage slug="offerup">
      <Ui />
    </CalculatorPage>
  );
}
