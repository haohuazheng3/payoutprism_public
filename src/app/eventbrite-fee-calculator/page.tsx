import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("eventbrite");

export default function Page() {
  return (
    <CalculatorPage slug="eventbrite">
      <Ui />
    </CalculatorPage>
  );
}
