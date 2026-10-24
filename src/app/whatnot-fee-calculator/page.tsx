import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("whatnot");

export default function Page() {
  return (
    <CalculatorPage slug="whatnot">
      <Ui />
    </CalculatorPage>
  );
}
