import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("fiverr");

export default function Page() {
  return (
    <CalculatorPage slug="fiverr">
      <Ui />
    </CalculatorPage>
  );
}
