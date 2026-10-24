import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("patreon");

export default function Page() {
  return (
    <CalculatorPage slug="patreon">
      <Ui />
    </CalculatorPage>
  );
}
