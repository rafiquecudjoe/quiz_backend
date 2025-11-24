export class SubmitQuizDto {
  userName: string;
  userEmail: string;
  questionIds: string[];
  answers: Record<string, string>;
}
