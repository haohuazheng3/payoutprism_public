import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("upwork");

export default function Page() {
  return (
    <CalculatorPage slug="upwork">
      <Ui />
    </CalculatorPage>
  );
}
