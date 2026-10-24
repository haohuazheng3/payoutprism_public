import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("stockx");

export default function Page() {
  return (
    <CalculatorPage slug="stockx">
      <Ui />
    </CalculatorPage>
  );
}
