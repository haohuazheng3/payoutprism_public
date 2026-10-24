import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("ko-fi");

export default function Page() {
  return (
    <CalculatorPage slug="ko-fi">
      <Ui />
    </CalculatorPage>
  );
}
