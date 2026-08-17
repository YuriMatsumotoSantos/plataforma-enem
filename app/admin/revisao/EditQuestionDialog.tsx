"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Question } from "./page";

type TopicOption = { id: string; area: string; subject: string; name: string };

const LETTERS = ["A", "B", "C", "D", "E"] as const;

export function EditQuestionDialog({
  question,
  onClose,
  onSaved,
}: {
  question: Question;
  onClose: () => void;
  onSaved: (updated: Question) => void;
}) {
  const [statement, setStatement] = useState(question.statement);
  const [alternativeTexts, setAlternativeTexts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const alt of question.alternatives) {
      initial[alt.letter] = alt.text;
    }
    return initial;
  });
  const [correctAnswer, setCorrectAnswer] = useState(question.correctAnswer);
  const [topicId, setTopicId] = useState(question.topic.id);
  const [topics, setTopics] = useState<TopicOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/topics")
      .then((response) => response.json())
      .then((data) => setTopics(data.topics))
      .catch(() => setError("Não foi possível carregar a lista de assuntos."));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/admin/questions/${question.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statement,
          alternatives: LETTERS.map((letter) => ({
            letter,
            text: alternativeTexts[letter] ?? "",
          })),
          correctAnswer,
          topicId,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Não foi possível salvar as alterações.");
        return;
      }

      const updatedTopic = topics?.find((t) => t.id === body.topicId);
      onSaved({
        ...question,
        statement: body.statement,
        alternatives: body.alternatives,
        correctAnswer: body.correctAnswer,
        status: body.status,
        topic: updatedTopic ?? question.topic,
      });
    } catch {
      setError("Não foi possível conectar. Verifique sua internet e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Editar questão — {question.year} Dia {question.examDay} Questão{" "}
            {question.questionNumber}
          </DialogTitle>
          <DialogDescription>
            Corrija o enunciado, as alternativas, a resposta correta ou o assunto.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="statement">Enunciado</Label>
            <Textarea
              id="statement"
              required
              rows={5}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
            />
          </div>

          {LETTERS.map((letter) => (
            <div key={letter} className="flex flex-col gap-2">
              <Label htmlFor={`alt-${letter}`}>Alternativa {letter}</Label>
              <Input
                id={`alt-${letter}`}
                required
                value={alternativeTexts[letter] ?? ""}
                onChange={(event) =>
                  setAlternativeTexts((prev) => ({ ...prev, [letter]: event.target.value }))
                }
              />
            </div>
          ))}

          <div className="flex flex-col gap-2">
            <Label htmlFor="correctAnswer">Resposta correta</Label>
            <Input
              id="correctAnswer"
              required
              value={correctAnswer}
              onChange={(event) => setCorrectAnswer(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="topic">Assunto</Label>
            <Select value={topicId} onValueChange={(value) => setTopicId(value ?? topicId)}>
              <SelectTrigger id="topic" className="w-full">
                <SelectValue placeholder="Escolha um assunto">
                  {(value: string) => {
                    const selected = topics?.find((t) => t.id === value);
                    return selected ? `${selected.subject} — ${selected.name}` : value;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {topics?.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    {topic.subject} — {topic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
