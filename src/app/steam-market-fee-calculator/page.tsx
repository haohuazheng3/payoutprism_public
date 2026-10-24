import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("steam-market");

export default function Page() {
  return (
    <CalculatorPage slug="steam-market">
      <Ui />
    </CalculatorPage>
  );
}
