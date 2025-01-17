import { SupportedChain } from "@/lib/chains";
import { MarketTypes, getMarketType } from "@/lib/market";
import { unescapeJson } from "@/lib/reality";
import { graphQLClient } from "@/lib/subgraph";
import { INVALID_RESULT_OUTCOME, INVALID_RESULT_OUTCOME_TEXT } from "@/lib/utils";
import { config } from "@/wagmi";
import { useQuery } from "@tanstack/react-query";
import { Address } from "viem";
import { marketFactoryAddress, readMarketViewGetMarket } from "./contracts/generated";
import { GetMarketQuery, getSdk } from "./queries/generated";
import { getOutcomes } from "./useCreateMarket";

export interface Question {
  id: `0x${string}`;
  arbitrator: Address;
  opening_ts: number;
  timeout: number;
  finalize_ts: number;
  is_pending_arbitration: boolean;
  best_answer: `0x${string}`;
  bond: bigint;
  min_bond: bigint;
}

export interface Market {
  id: Address;
  marketName: string;
  outcomes: readonly string[];
  wrappedTokens: Address[];
  outcomesSupply: bigint;
  conditionId: `0x${string}`;
  questionId: `0x${string}`;
  templateId: bigint;
  questions: readonly Question[];
  encodedQuestions: readonly string[];
  lowerBound: bigint;
  upperBound: bigint;
  payoutReported: boolean;
  index?: number;
}

export type OnChainMarket = Awaited<ReturnType<typeof readMarketViewGetMarket>> & {
  creator?: string | null;
};

export function mapOnChainMarket(onChainMarket: OnChainMarket): Market {
  const market: Market = {
    ...onChainMarket,
    wrappedTokens: onChainMarket.wrappedTokens.slice(),
    marketName: unescapeJson(onChainMarket.marketName),
    outcomes: onChainMarket.outcomes.map((outcome) => {
      if (outcome === INVALID_RESULT_OUTCOME) {
        return INVALID_RESULT_OUTCOME_TEXT;
      }
      return unescapeJson(outcome);
    }),
    questions: onChainMarket.questions.map(
      (question, i) =>
        ({
          id: onChainMarket.questionsIds[i],
          ...question,
        }) as Question,
    ),
  };

  if (getMarketType(market) === MarketTypes.SCALAR) {
    market.outcomes = getOutcomes(
      market.outcomes.slice(),
      Number(market.lowerBound),
      Number(market.upperBound),
      getMarketType(market),
    );
  }
  return market;
}

const useGraphMarket = (marketId: Address, chainId: SupportedChain) => {
  return useQuery<GetMarketQuery["market"] | undefined, Error>({
    queryKey: ["useMarket", "useGraphMarket", marketId],
    queryFn: async () => {
      const client = graphQLClient(chainId);

      if (client) {
        const { market } = await getSdk(client).GetMarket({ id: marketId.toLocaleLowerCase() });

        if (!market) {
          throw new Error("Market not found");
        }

        return market;
      }

      throw new Error("Subgraph not available");
    },
  });
};

const useOnChainMarket = (marketId: Address, chainId: SupportedChain) => {
  const { data: graphMarket } = useGraphMarket(marketId, chainId);
  const factory = graphMarket?.factory || marketFactoryAddress[chainId];
  return useQuery<Market | undefined, Error>({
    queryKey: ["useMarket", "useOnChainMarket", marketId, chainId, factory],
    queryFn: async () => {
      return mapOnChainMarket(
        await readMarketViewGetMarket(config, {
          args: [factory, marketId],
          chainId,
        }),
      );
    },
    refetchOnWindowFocus: true,
  });
};

export const useMarket = (marketId: Address, chainId: SupportedChain) => {
  return useOnChainMarket(marketId, chainId);
};
