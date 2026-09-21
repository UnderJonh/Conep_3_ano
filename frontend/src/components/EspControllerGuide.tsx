export function EspControllerGuide({ multiplayer }: { multiplayer: boolean }) {
  return <div className="esp-setup controller-guide">
    <section className="guide-step">
      <h2>O que a gente queria fazer</h2>
      <p>
        A ideia original era um tapete de pisada. Dois sensores de pressão ligados à ESP32 mediam a
        força de cada pisada; a placa entrava no Wi-Fi da escola, mandava cada leitura por WebSocket
        para um servidor na nuvem, e o servidor repassava o comando para este site. Pisou forte, a
        galinha andou.
      </p>
    </section>

    <section className="guide-step guide-step-fail">
      <h2>Por que não deu certo</h2>
      <p>O caminho era comprido demais para o que a gente precisava:</p>
      <ul>
        <li><strong>Quatro elos em série.</strong> Wi-Fi da escola, servidor na nuvem, banco de dados e navegador. Bastava um cair e ninguém jogava.</li>
        <li><strong>O servidor parou de aceitar a conexão.</strong> A placa ficava tentando reconectar a cada segundo e nunca entrava.</li>
        <li><strong>Muita burocracia antes do primeiro passo.</strong> Só para abrir a conexão, a ESP32 precisava acertar o relógio pela internet e carregar certificados de segurança.</li>
        <li><strong>Atraso.</strong> A pisada ia até a nuvem e voltava. Em um jogo de reflexo, isso se sente.</li>
        <li><strong>O sensor era lento.</strong> A pressão levava até 3 segundos para descarregar, e a pisada acabava descartada.</li>
      </ul>
      <p className="small">
        Numa feira, com Wi-Fi de visitante e pouco tempo para montar a bancada, nada disso se sustenta.
      </p>
    </section>

    <section className="guide-step guide-step-now">
      <h2>Como está agora</h2>
      <p>
        A ESP32 deixou de ser um sensor conectado à internet e virou um <strong>controle de
        videogame</strong>. Dois botões, um cabo USB, e acabou. Sem Wi-Fi, sem nuvem, sem banco de
        dados, sem certificado.
      </p>
      <dl className="guide-pins">
        <div>
          <dt>GPIO 34</dt>
          <dd>Botão do jogador 1</dd>
          <dd className="small">Simula a tecla ESPAÇO</dd>
          <dd className="small">LED no GPIO 32</dd>
        </div>
        <div>
          <dt>GPIO 35</dt>
          <dd>Botão do jogador 2</dd>
          <dd className="small">Simula a tecla ENTER</dd>
          <dd className="small">LED no GPIO 33</dd>
        </div>
      </dl>
      <p>
        Cada botão tem um LED que funciona ao contrário: fica <strong>aceso esperando</strong> o
        toque e <strong>apaga enquanto está apertado</strong>. De longe dá para ver de quem é a vez.
      </p>
      <p>
        {multiplayer
          ? 'Os dois botões estão ativos nesta partida: cada um move o seu personagem.'
          : 'No modo de 1 jogador só o botão do GPIO 34 move o personagem. Abra o multiplayer local para usar os dois.'}
      </p>
    </section>

    <section className="guide-step">
      <h2>Como vai funcionar</h2>
      <ol>
        <li>Ligue a ESP32 no computador pelo cabo USB.</li>
        <li>Abra este site e clique em <strong>Conectar controle</strong>.</li>
        <li>O navegador pergunta qual porta usar. Escolha a da ESP32.</li>
        <li>Apertou o botão, a placa manda um caractere pelo cabo e o personagem anda na hora.</li>
      </ol>
      <p>
        O caminho inteiro cabe em cima da mesa: <strong>botão → placa → cabo → navegador</strong>.
        Se alguma coisa travar, dá para apontar o dedo no elo com problema em vez de adivinhar.
      </p>
      <p className="small">
        A leitura da porta usa a Web Serial API, que funciona no Chrome e no Edge. No Firefox e no
        Safari o site continua jogável pelo teclado.
      </p>
    </section>

    <details>
      <summary>Como montar os botões</summary>
      <p>
        Os pinos <strong>GPIO 34 e 35 são só de entrada</strong> e, diferente dos outros, não têm
        resistor interno. Cada botão precisa do seu resistor de <strong>pull-down externo</strong>:
      </p>
      <ol>
        <li>Um lado do botão no <code>3V3</code>.</li>
        <li>O outro lado no <code>GPIO 34</code> (ou <code>35</code>).</li>
        <li>Um resistor de <code>10 kΩ</code> desse mesmo lado até o <code>GND</code>.</li>
      </ol>
      <p className="small">
        Sem o resistor o pino fica solto, pega ruído do ambiente e o personagem anda sozinho. Com
        ele, o pino fica em 0 V parado e vai a 3,3 V só enquanto o botão estiver apertado.
      </p>
      <p>
        O LED de cada botão vai no <code>GPIO 32</code> (ou <code>33</code>), com um resistor de
        <code>220 Ω</code> em série até o <code>GND</code> — a não ser que o LED do botão já venha
        com o resistor dele.
      </p>
    </details>
  </div>;
}
