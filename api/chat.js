
const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// FASEEH AI - GEMINI CONFIGURATION
// ==========================================

const GEMINI_MODEL = "gemini-3.8-flash";

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT = 18000;

// ==========================================
// VERCEL API HANDLER
// ==========================================

module.exports = async function handler(req, res) {

  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed.",
    });
  }

  // Get API key
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing from Vercel Environment Variables.",
    });
  }

  try {

    // ==========================================
    // 1. RECEIVE USER DATA
    // ==========================================

    const { messages, lessonContext } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "Please send a message.",
      });
    }

    // Prevent excessively large conversations
    if (messages.length > 30) {
      return res.status(400).json({
        error: "Conversation is too long. Please start a new chat.",
      });
    }

    // ==========================================
    // 2. FASEEH AI SYSTEM INSTRUCTIONS
    // ==========================================

    const systemInstruction = `
أنت فصيح AI، معلم لغة عربية ذكي ولطيف،
متخصص في مساعدة تلاميذ الصف السادس الابتدائي في مصر.

هدفك هو جعل اللغة العربية سهلة وممتعة ومفهومة.

قواعدك الأساسية:

1. أجب باللغة العربية الواضحة والمناسبة للمرحلة الابتدائية.

2. اشرح المعلومات خطوة بخطوة بطريقة سهلة.

3. ساعد الطالب في:
   - النحو.
   - الإملاء.
   - القراءة.
   - التعبير.
   - النصوص.
   - البلاغة.
   - فهم الدروس.

4. عند الإعراب:
   - اذكر الكلمة.
   - اذكر موقعها الإعرابي.
   - اذكر علامة الإعراب.
   - اشرح سبب الإعراب.
   - وضح نوع الخبر إذا كان المطلوب.

5. استخدم أمثلة بسيطة وواضحة.

6. لا تخترع معلومات أو إجابات.

7. إذا لم تكن متأكدًا، وضح ذلك للطالب.

8. كن مشجعًا وصبورًا ومحترمًا.

9. لا تجعل الإجابات طويلة بلا داعٍ.

10. لا تعطِ إجابة مختلفة عن المطلوب في السؤال.

11. استخدم سياق المحادثة السابقة لفهم أسئلة الطالب.

12. إذا أرسل الطالب سؤالًا من درس محدد،
    اعتمد على محتوى الدرس المرفق.

13. إذا طلب الطالب شرحًا تفصيليًا،
    قدم شرحًا شاملًا ومنظمًا.

14. إذا طلب إجابة مباشرة،
    أعطه الإجابة مباشرة دون مقدمات طويلة.

معلومات الدرس الحالي:

${lessonContext
  ? JSON.stringify(lessonContext)
  : "لا يوجد درس محدد حاليًا."}
`;

    // ==========================================
    // 3. CONVERT MESSAGES TO GEMINI FORMAT
    // ==========================================

    const contents = messages
      .filter((message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
      )
      .map((message) => ({
        role:
          message.role === "assistant"
            ? "model"
            : "user",

        parts: [
          {
            text: message.content.trim(),
          },
        ],
      }));

    if (contents.length === 0) {
      return res.status(400).json({
        error: "No valid messages were provided.",
      });
    }

    // ==========================================
    // 4. GEMINI REQUEST CONFIGURATION
    // ==========================================

    const requestBody = {
      systemInstruction: {
        parts: [
          {
            text: systemInstruction,
          },
        ],
      },

      contents,

      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 700,
        topP: 0.85,
      },
    };

    // ==========================================
    // 5. SEND REQUEST WITH RETRIES
    // ==========================================

    let lastError = null;

    for (
      let attempt = 1;
      attempt <= MAX_ATTEMPTS;
      attempt++
    ) {

      const controller = new AbortController();

      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT
      );

      try {

        const response = await fetch(
          GEMINI_ENDPOINT,
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },

            body: JSON.stringify(requestBody),

            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        // Read Gemini response
        let result;

        try {
          result = await response.json();
        } catch {
          result = {};
        }

        // ==========================================
        // 6. SUCCESS RESPONSE
        // ==========================================

        if (response.ok) {

          const candidate = result.candidates?.[0];

          const reply = candidate?.content?.parts
            ?.map((part) => part.text || "")
            .join("")
            .trim();

          if (!reply) {

            console.error(
              "Gemini empty response:",
              candidate?.finishReason
            );

            return res.status(502).json({
              error:
                "Gemini could not generate an answer. Please try again.",
            });
          }

          return res.status(200).json({
            reply,
          });
        }

        // ==========================================
        // 7. HANDLE API ERRORS
        // ==========================================

        const errorMessage =
          result.error?.message ||
          "Gemini API request failed.";

        lastError = new Error(errorMessage);

        const retryableStatuses = [
          429,
          500,
          502,
          503,
          504,
        ];

        if (
          !retryableStatuses.includes(response.status) ||
          attempt === MAX_ATTEMPTS
        ) {

          console.error("Gemini API error:", {
            status: response.status,
            message: errorMessage,
            attempt,
          });

          return res.status(response.status).json({
            error: errorMessage,
          });
        }

      } catch (error) {

        clearTimeout(timeoutId);

        lastError = error;

        if (attempt === MAX_ATTEMPTS) {

          console.error(
            "Gemini connection error:",
            error
          );

          if (error.name === "AbortError") {
            return res.status(504).json({
              error: "Gemini took too long to respond. Please try again.",
            });
          }

          return res.status(502).json({
            error: "Could not connect to Gemini. Please try again.",
          });
        }

      }

      // Retry only when necessary
      await sleep(500);
    }

    return res.status(502).json({
      error:
        lastError?.message ||
        "Gemini is temporarily unavailable.",
    });

  } catch (error) {

    console.error("FASEEH AI SERVER ERROR:", error);

    return res.status(500).json({
      error: "An unexpected server error occurred.",
    });

  }
};
