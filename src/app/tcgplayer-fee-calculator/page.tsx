import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("tcgplayer");

export default function Page() {
  return (
    <CalculatorPage slug="tcgplayer">
      <Ui />
    </CalculatorPage>
  );
}
