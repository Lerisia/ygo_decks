import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import QuestionItem from "../components/QuestionItem";
import { fetchQuestions } from "../api/questionApi";
import lookupTableData from "../data/lookup_table.json";

type LookupTable = { [key: string]: number };
const lookupTable: LookupTable = lookupTableData;

type Question = {
  key: string;
  question: string;
  options: { value: number; label: string }[];
};

function QuestionPage() {
  const [requiredQuestions, setRequiredQuestions] = useState<Question[]>([]);
  const [optionalQuestions, setOptionalQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptionalQuestions, setSelectedOptionalQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<{ key: string; value: number }[]>([]);
  
  const navigate = useNavigate();

  useEffect(() => {
    fetchQuestions()
      .then((data) => {
        const required = data.slice(0, 3);
        const optional = data.slice(3, 7);
        setRequiredQuestions(required);
        setOptionalQuestions(optional);
      })
      .catch((error) => console.error("Error loading questions:", error));
  }, []);

  const generateAnswerKey = (answers: { key: string; value: number }[]) => {
    return answers
      .map(({ key, value }) => `${key}=${value}`)
      .sort()
      .join("|");
  };

  const handleSelectOptionalQuestion = (question: Question) => {
    if (!answers.some((a) => a.key === question.key)) {
      setSelectedOptionalQuestions([question]);
    }
  };
  
  // get # of hidden questions (that have only 1 available answer)
  const getHiddenQuestionsCount = () => {
    return optionalQuestions.filter((question) => getAvailableOptions(question).length <= 1).length;
  };

  const getAvailableOptions = (question: Question) => {
    return question.options.filter((option) => {
      const newAnswers = [...answers, { key: question.key, value: option.value }];
      return generateAnswerKey(newAnswers) in lookupTable;
    });
  };

  const getValidOptionalQuestions = () => {
    return optionalQuestions.filter(
      (question) => getAvailableOptions(question).length > 1 || answers.some((a) => a.key === question.key)
    );
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

    // case 4: Do nothing
    if (!isRequired && !isOptional) {
        return;
    }
  };

  useEffect(() => {
    const totalQuestions = requiredQuestions.length + optionalQuestions.length;

    if (totalQuestions > 0 && answers.length + getHiddenQuestionsCount() >= totalQuestions) {
      const answerKey = generateAnswerKey(answers);

      if (Object.keys(lookupTable).some((key) => key.startsWith(answerKey))) {
        console.log("All questions answered, navigating to result page.");
        localStorage.setItem("answerKey", answerKey);
        navigate("/result");
      }
    }
  }, [answers, lookupTable, navigate, requiredQuestions, optionalQuestions]);

  useEffect(() => {
    if (answers.length > 0) {
      const answerKey = generateAnswerKey(answers);
      console.log("Current answers:", answerKey);

      if (lookupTable[answerKey] === 1) {
        console.log("Go to the result page.");
        localStorage.setItem("answerKey", answerKey);
        navigate("/result");
      }
    }
  }, [answers, navigate]);

  return (
    <div className="mb-4 p-4 text-left h-auto min-h-screen flex flex-col items-center">
      <div className="mt-6 w-full max-w-lg">
        {currentIndex < requiredQuestions.length ? (
          <QuestionItem
            key={requiredQuestions[currentIndex].key}
            question={requiredQuestions[currentIndex].question}
            options={getAvailableOptions(requiredQuestions[currentIndex])}
            selectedValue={answers.find((a) => a.key === requiredQuestions[currentIndex].key)?.value}
            onSelect={(value) => handleAnswer(requiredQuestions[currentIndex].key, value)}
          />
        ) : selectedOptionalQuestions.length > 0 ? (
          <QuestionItem
            key={selectedOptionalQuestions[0].key}
            question={selectedOptionalQuestions[0].question}
            options={getAvailableOptions(selectedOptionalQuestions[0])}
            selectedValue={answers.find((a) => a.key === selectedOptionalQuestions[0].key)?.value}
            onSelect={(value) => handleAnswer(selectedOptionalQuestions[0].key, value)}
          />
        ) : (
          <div>
            <h3 className="text-lg font-semibold space-y-4 text-gray-900 dark:text-white">
              다음 질문을 골라 주세요
            </h3>
            <div className="flex flex-col items-center space-y-4 w-full">
              {getValidOptionalQuestions().length > 0 ? (
                getValidOptionalQuestions().map((q) => {
                  const isAnswered = answers.some((a) => a.key === q.key); // 🔥 이미 답변한 질문 확인

                  return (
                    <button
                      key={q.key}
                      className={`px-4 py-2 rounded-lg transition break-keep w-full max-w-2xl text-center
                        ${
                          isAnswered
                            ? "bg-gray-300 text-gray-600 cursor-not-allowed dark:bg-gray-600 dark:text-gray-400" // 🔥 이미 답변한 질문은 회색 처리
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
        )}
      </div>
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
