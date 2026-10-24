import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("etsy-uk");

export default function Page() {
  return (
    <CalculatorPage slug="etsy-uk">
      <Ui />
    </CalculatorPage>
  );
}
