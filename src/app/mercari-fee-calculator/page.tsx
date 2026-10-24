import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("mercari");

export default function Page() {
  return (
    <CalculatorPage slug="mercari">
      <Ui />
    </CalculatorPage>
  );
}
