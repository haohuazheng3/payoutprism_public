import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("etsy");

export default function Page() {
  return (
    <CalculatorPage slug="etsy">
      <Ui />
    </CalculatorPage>
  );
}
