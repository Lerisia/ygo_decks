import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import QuestionItem from "../components/QuestionItem";
import { fetchQuestions, fetchRecommendStep } from "../api/questionApi";
import {
  buildAnswerKey, visibleOptions, hiddenOptionalCount, isFinished,
  type Question, type Answer, type Available,
} from "../utils/recommendFlow";

type Step = { key: string; candidateCount: number; available: Available };

function QuestionPage() {
  const [requiredQuestions, setRequiredQuestions] = useState<Question[]>([]);
  const [optionalQuestions, setOptionalQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptionalQuestions, setSelectedOptionalQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [step, setStep] = useState<Step | null>(null);
  const [stepError, setStepError] = useState(false);

  const navigate = useNavigate();
  const answerKey = buildAnswerKey(answers);
  const stepReady = step !== null && step.key === answerKey;
  const available = stepReady ? step.available : null;

  useEffect(() => {
    fetchQuestions()
      .then((data) => {
        setRequiredQuestions(data.slice(0, 4));
        setOptionalQuestions(data.slice(4, 7));
      })
      .catch((error) => console.error("Error loading questions:", error));
  }, []);

  // Ask the server what is still possible after every answer change.
  useEffect(() => {
    let cancelled = false;
    setStepError(false);
    fetchRecommendStep(answerKey)
      .then((data) => {
        if (cancelled) return;
        setStep({ key: answerKey, candidateCount: data.candidate_count, available: data.available });
      })
      .catch((error) => {
        console.error("추천 단계 조회 실패:", error);
        if (!cancelled) setStepError(true);
      });
    return () => { cancelled = true; };
  }, [answerKey]);

  const getAvailableOptions = (question: Question) => visibleOptions(question, available);
  const getHiddenQuestionsCount = () => hiddenOptionalCount(optionalQuestions, answers, available);

  const getValidOptionalQuestions = () =>
    optionalQuestions.filter(
      (question) => getAvailableOptions(question).length > 1 || answers.some((a) => a.key === question.key)
    );

  const handleSelectOptionalQuestion = (question: Question) => {
    if (!answers.some((a) => a.key === question.key)) {
      setSelectedOptionalQuestions([question]);
    }
  };

  const handleAnswer = (questionKey: string, value: number) => {
    setAnswers((prev) => [...prev, { key: questionKey, value }]);
    setCurrentIndex((prev) => prev + 1);
    setSelectedOptionalQuestions([]);
  };

  const handleGoBack = () => {
    if (answers.length === 0) return;

    const lastAnswer = answers[answers.length - 1];
    const isRequired = requiredQuestions.some((q) => q.key === lastAnswer.key);
    const isOptional = optionalQuestions.some((q) => q.key === lastAnswer.key);

    // case 1: In selected question, just go to question selection page
    if (selectedOptionalQuestions.length > 0) {
        setSelectedOptionalQuestions([]);
        return;
    }

    // case 2: In question selection page and previous question is optional,
    // go back to that question and remove recent answer
    if (!isRequired && isOptional) {
        setAnswers((prev) => prev.slice(0, -1));
        setSelectedOptionalQuestions(optionalQuestions.filter((q) => q.key === lastAnswer.key));
        return;
    }

    // case 3: In selection page or question page and previous question is required.
    if (isRequired && !isOptional) {
        setAnswers((prev) => prev.slice(0, -1));
        setCurrentIndex(answers.length - 1);
    }
  };

  useEffect(() => {
    if (!stepReady || requiredQuestions.length === 0) return;

    if (step.candidateCount === 0 && answers.length === 0) {
      navigate("/no-results");
      return;
    }

    const finished = isFinished({
      answered: answers.length,
      hidden: getHiddenQuestionsCount(),
      total: requiredQuestions.length + optionalQuestions.length,
      candidateCount: step.candidateCount,
    });
    if (finished) {
      localStorage.setItem("answerKey", answerKey);
      navigate("/result");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, stepReady, answers, requiredQuestions, optionalQuestions, navigate]);

  const renderBody = () => {
    if (stepError) {
      return <p className="text-red-500">추천 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>;
    }
    if (!stepReady || requiredQuestions.length === 0) {
      return <p className="text-gray-500 dark:text-gray-400">로딩 중...</p>;
    }
    if (currentIndex < requiredQuestions.length) {
      const q = requiredQuestions[currentIndex];
      return (
        <QuestionItem
          key={q.key}
          question={q.question}
          options={getAvailableOptions(q)}
          selectedValue={answers.find((a) => a.key === q.key)?.value ?? undefined}
          onSelect={(value) => handleAnswer(q.key, value)}
        />
      );
    }
    if (selectedOptionalQuestions.length > 0) {
      const q = selectedOptionalQuestions[0];
      return (
        <QuestionItem
          key={q.key}
          question={q.question}
          options={getAvailableOptions(q)}
          selectedValue={answers.find((a) => a.key === q.key)?.value ?? undefined}
          onSelect={(value) => handleAnswer(q.key, value)}
        />
      );
    }
    return (
      <div>
        <h3 className="mb-4 text-lg font-semibold space-y-4 text-gray-900 dark:text-white">
          다음 질문을 골라 주세요
        </h3>
        <div className="flex flex-col items-center space-y-4 w-full">
          {getValidOptionalQuestions().length > 0 ? (
            getValidOptionalQuestions().map((q) => {
              const isAnswered = answers.some((a) => a.key === q.key);
              return (
                <button
                  key={q.key}
                  className={`px-4 py-2 rounded-lg transition break-keep w-full max-w-2xl text-center
                    ${
                      isAnswered
                        ? "bg-gray-300 text-gray-600 cursor-not-allowed dark:bg-gray-600 dark:text-gray-400"
                        : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 hover:dark:bg-gray-600 dark:text-gray-100"
                    }`}
                  onClick={() => handleSelectOptionalQuestion(q)}
                  disabled={isAnswered}
                >
                  {q.question}
                </button>
              );
            })
          ) : (
            <p className="text-gray-500 dark:text-gray-400">선택할 수 있는 추가 질문이 없습니다.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mb-4 p-4 text-left h-auto min-h-screen flex flex-col items-center">
      <div className="mt-6 w-full max-w-lg">{renderBody()}</div>
      <button
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        onClick={handleGoBack}
        disabled={answers.length === 0}
      >
        뒤로 가기
      </button>
    </div>
  );
}

export default QuestionPage;
