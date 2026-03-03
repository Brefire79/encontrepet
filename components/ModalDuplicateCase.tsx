import React, { useState } from 'react';

export type DuplicateAction = 'view' | 'link' | 'continue' | 'suspicious';

export interface DuplicateCandidate {
  id: string;
  species: string;
  hashDistance: number;
  geoDistanceKm: number;
  isStrongSuspicion?: boolean;
}

interface Props {
  candidate: DuplicateCandidate;
  onAction: (action: DuplicateAction, payload?: { suspiciousReason?: string }) => void;
}

export function ModalDuplicateCase({ candidate, onAction }: Props) {
  const [reason, setReason] = useState('');

  return (
    <div className="modal duplicate-modal">
      <div className="modal-content">
        <h3>Possível duplicidade</h3>
        {candidate.isStrongSuspicion && (
          <div className="strong-warning">
            Similaridade muito alta em distância muito grande.
          </div>
        )}
        <p>Espécie: {candidate.species}</p>
        <p>Hamming: {candidate.hashDistance}</p>
        <p>Distância: {candidate.geoDistanceKm.toFixed(1)} km</p>

        <label>
          Motivo da suspeita
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </label>

        <div className="actions">
          <button onClick={() => onAction('view')}>Ver ocorrência similar</button>
          <button onClick={() => onAction('link')}>Vincular ao caso</button>
          <button onClick={() => onAction('continue')}>Continuar mesmo assim</button>
          <button onClick={() => onAction('suspicious', { suspiciousReason: reason.trim() })}>
            Marcar como suspeito
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalDuplicateCase;
