

const GROQ_ENDPOINT =
  "https://api.groq.com/openai/v1/chat/completions";

const MODEL = "openai/gpt-oss-120b";

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed.",
    });
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GROQ_API_KEY is missing from Vercel.",
      });
    }

    const { messages, lessonContext } = req.body || {};

    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({
        error: "Please send a message.",
      });
    }

    const validMessages = messages
      .filter(
        (m) =>
          m &&
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string" &&
          m.content.trim()
      )
      .map((m) => ({
        role: m.role,
        content: m.content.trim(),
      }));

    if (!validMessages.length) {
      return res.status(400).json({
        error: "No valid messages provided.",
      });
    }

    const systemInstruction = `
أنت فصيح AI، معلم لغة عربية ذكي ولطيف
متخصص في مساعدة تلاميذ الصف السادس الابتدائي في مصر.

قواعدك:
1. أجب باللغة العربية الواضحة.
2. اشرح خطوة بخطوة بطريقة سهلة.
3. ساعد الطالب في النحو والإملاء والقراءة والتعبير.
4. عند الإعراب اذكر الموقع الإعرابي والعلامة والسبب.
5. وضح أنواع الخبر والمبتدأ عند الحاجة.
6. استخدم أمثلة مناسبة للمرحلة الابتدائية.
7. لا تخترع معلومات.
8. كن مشجعًا وصبورًا ومحترمًا.
9. اجعل الإجابات منظمة.
10. إذا طلب الطالب إجابة مباشرة فأجب مباشرة.
11. استخدم سياق المحادثة السابقة.
12. اعتمد على الدرس المرفق عند الإجابة عن أسئلته.

معلومات الدرس الحالي:
${lessonContext
  ? JSON.stringify(lessonContext)
  : "لا يوجد درس محدد حاليًا."}
`;

    const requestBody = {
      model: MODEL,
      messages: [
        {
          role: "system",
          content: systemInstruction,
        },
        ...validMessages,
      ],
      max_completion_tokens: 900,
      reasoning_effort: "low",
      stream: false,
    };

    let lastError;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        20000
      );

      try {
        const response = await fetch(GROQ_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        const raw = await response.text();

        let result;

        try {
          result = JSON.parse(raw);
        } catch {
          result = {
            error: {
              message: "Groq returned an invalid response.",
            },
          };
        }

        if (!response.ok) {
          const message =
            result.error?.message || "Groq request failed.";

          lastError = new Error(message);

          const retryable = [429, 500, 502, 503, 504];

          if (
            !retryable.includes(response.status) ||
            attempt === 2
          ) {
            console.error("GROQ ERROR:", {
              status: response.status,
              message,
            });

            return res.status(502).json({
              error: message,
            });
          }

          await sleep(1000);
          continue;
        }

        const reply =
          result.choices?.[0]?.message?.content?.trim();

        if (!reply) {
          return res.status(502).json({
            error: "Groq returned an empty answer.",
          });
        }

        return res.status(200).json({
          reply,
        });

      } catch (error) {
        lastError = error;

        if (attempt === 2) {
          console.error("GROQ CONNECTION ERROR:", error);

          return res.status(502).json({
            error:
              error.name === "AbortError"
                ? "Groq request timed out."
                : "Could not connect to Groq.",
          });
        }

        await sleep(500);

      } finally {
        clearTimeout(timeout);
      }
    }

    return res.status(502).json({
      error: lastError?.message || "Groq is unavailable.",
    });

  } catch (error) {
    console.error("FASEEH SERVER ERROR:", error);

    return res.status(500).json({
      error: "An unexpected server error occurred.",
    });
  }
};
