import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("twitch-bits");

export default function Page() {
  return (
    <CalculatorPage slug="twitch-bits">
      <Ui />
    </CalculatorPage>
  );
}
