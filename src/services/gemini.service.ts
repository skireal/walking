import { Injectable, signal } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';
import { GEMINI_API_KEY } from '../env';

export interface RouteSuggestion {
  routeName: string;
  description: string;
  duration: string;
  distance: string;
  pointsOfInterest: string[];
  directions: string[];
}

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private genAI: GoogleGenAI | null = null;

  constructor() {
    // Ключ берём из центрального env-файла (не из process.env, чтобы не падать в браузере)
    const apiKey = GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenAI({ apiKey });
    } else {
      console.error('GEMINI_API_KEY is empty. Configure it in src/env.ts (локально, без коммита).');
    }
  }

  async getRouteSuggestion(location: string, duration: number): Promise<RouteSuggestion> {
    if (!this.genAI) {
      throw new Error('Gemini AI client is not initialized. Check API Key.');
    }

    const model = 'gemini-2.5-flash';
    const prompt = `Suggest a scenic walking route starting near ${location} that takes about ${duration} minutes for an average walker. Describe the route, mention a few points of interest by name, and provide simple turn-by-turn directions.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        routeName: { type: Type.STRING, description: 'A creative and descriptive name for the walking route.' },
        description: { type: Type.STRING, description: 'A brief, engaging summary of the walk.' },
        duration: { type: Type.STRING, description: 'Estimated duration of the walk in minutes, as a string (e.g., "30 minutes").' },
        distance: { type: Type.STRING, description: 'Estimated distance of the walk, as a string (e.g., "2.5 km").' },
        pointsOfInterest: {
          type: Type.ARRAY,
          description: 'An array of 2-4 key points of interest.',
          items: {
            type: Type.STRING,
            description: 'The name of a point of interest.',
          },
        },
        directions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'A list of simple, turn-by-turn directions.',
        },
      },
      required: ['routeName', 'description', 'duration', 'distance', 'pointsOfInterest', 'directions'],
    };

    try {
      const response = await this.genAI.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          systemInstruction: 'You are an expert local guide. Your primary goal is to suggest creative and interesting walking routes.',
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.7,
        },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error('Empty response from Gemini API.');
      }
      return JSON.parse(text) as RouteSuggestion;
    } catch (error) {
      console.error('Error calling Gemini API for route suggestion:', error);
      throw new Error('Failed to get route suggestion from AI.');
    }
  }

  async generateImageDescription(base64ImageData: string): Promise<string> {
    if (!this.genAI) {
      throw new Error('Gemini AI client is not initialized. Check API Key.');
    }

    const model = 'gemini-2.5-flash';
    const imagePart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64ImageData,
      },
    };
    const textPart = {
      text: 'Describe this image for a personal walking journal. Be creative and evocative. Focus on what makes this scene interesting or unique from the perspective of an urban explorer.',
    };

    try {
      const response = await this.genAI.models.generateContent({
        model: model,
        contents: { parts: [imagePart, textPart] },
        config: {
          temperature: 0.5,
          maxOutputTokens: 150,
        },
      });
      const text = response.text?.trim();
      if (!text) {
        throw new Error('Empty response from Gemini API.');
      }
      return text;
    } catch (error) {
      console.error('Error calling Gemini API for image description:', error);
      throw new Error('Failed to generate image description from AI.');
    }
  }
}
