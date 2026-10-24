import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("twitch-sub");

export default function Page() {
  return (
    <CalculatorPage slug="twitch-sub">
      <Ui />
    </CalculatorPage>
  );
}
