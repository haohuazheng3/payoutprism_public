import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("ebay");

export default function Page() {
  return (
    <CalculatorPage slug="ebay">
      <Ui />
    </CalculatorPage>
  );
}
