import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("ebay-uk");

export default function Page() {
  return (
    <CalculatorPage slug="ebay-uk">
      <Ui />
    </CalculatorPage>
  );
}
