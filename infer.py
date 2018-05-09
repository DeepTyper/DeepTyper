from __future__ import print_function # Use a function definition from future version (say 3.x from 2.7 interpreter)
import requests
import os
import sys

import math
import numpy as np
import scipy.sparse
import cntk as C

import re
import string
import time

#C.device.try_set_default_device(C.device.cpu())

regex = re.compile(r"^[^\d\W]\w*$", re.UNICODE)
keywords = ["async", "await", "break", "continue", "class", "extends", "constructor", "super", "extends", "const", "let", "var", "debugger", "delete", "do", "while", "export", "import", "for", "each", "in", "of", "function", "return", "get", "set", "if", "else", "instanceof", "typeof", "null", "undefined", "switch", "case", "default", "this", "true", "false", "try", "catch", "finally", "void", "yield", "any", "boolean", "null", "never", "number", "string", "symbol", "undefined", "void", "as", "is", "enum", "type", "interface", "abstract", "implements", "static", "readonly", "private", "protected", "public", "declare", "module", "namespace", "require", "from", "of", "package"]

files = {
	'train': { 'file': 'data/train.ctf', 'location': 0 },
	'valid': { 'file': 'data/valid.ctf', 'location': 0 },
	'test': { 'file': 'data/test.ctf', 'location': 0 },
	'source': { 'file': 'data/source_wl', 'location': 1 },
	'target': { 'file': 'data/target_wl', 'location': 1 }
}

# load dictionaries
source_wl = [line.rstrip('\n') for line in open(files['source']['file'])]
target_wl = [line.rstrip('\n') for line in open(files['target']['file'])]
source_dict = {source_wl[i]:i for i in range(len(source_wl))}
target_dict = {target_wl[i]:i for i in range(len(target_wl))}

# number of words in vocab, slot labels, and intent labels
vocab_size = len(source_dict)
num_labels = len(target_dict)
epoch_size = 17.955*1000*1000
minibatch_size = 5000
emb_dim = 300
hidden_dim = 650
num_epochs = 10

# Create the containers for input feature (x) and the label (y)
x = C.sequence.input_variable(vocab_size, name="x")
y = C.sequence.input_variable(num_labels, name="y")
t = C.sequence.input_variable(hidden_dim, name="t")

def BiRecurrence(fwd, bwd):
	F = C.layers.Recurrence(fwd)
	G = C.layers.Recurrence(bwd, go_backwards=True)
	x = C.placeholder()
	apply_x = C.splice(F(x), G(x))
	return apply_x

def create_model():
	embed = C.layers.Embedding(emb_dim, name='embed')
	encoder = BiRecurrence(C.layers.GRU(hidden_dim//2), C.layers.GRU(hidden_dim//2))
	recoder = BiRecurrence(C.layers.GRU(hidden_dim//2), C.layers.GRU(hidden_dim//2))
	project = C.layers.Dense(num_labels, name='classify')
	do = C.layers.Dropout(0.5)
	
	def recode(x, t):
		inp = embed(x)
		inp = C.layers.LayerNormalization()(inp)
		
		enc = encoder(inp)
		rec = recoder(enc + t)
		proj = project(do(rec))
		
		dec = C.ops.softmax(proj)
		return enc, dec
	return recode

def criterion(model, labels):
	ce	 = -C.reduce_sum(labels*C.ops.log(model))
	errs = C.classification_error(model, labels)
	return ce, errs

def enhance_data(data, enc):
	guesses = enc.eval({x: data[x]})
	inputs = C.ops.argmax(x).eval({x: data[x]})
	tables = []
	for i in range(len(inputs)):
		ts = []
		table = {}
		counts = {}
		for j in range(len(inputs[i])):
			inp = int(inputs[i][j])
			if inp not in table:
				table[inp] = guesses[i][j]
				counts[inp] = 1
			else:
				table[inp] += guesses[i][j]
				counts[inp] += 1
		for inp in table:
			table[inp] /= counts[inp]
		for j in range(len(inputs[i])):
			inp = int(inputs[i][j])
			ts.append(table[inp])
		tables.append(np.array(np.float32(ts)))
	s = C.io.MinibatchSourceFromData(dict(t=(tables, C.layers.typing.Sequence[C.layers.typing.tensor])))
	mems = s.next_minibatch(minibatch_size)
	data[t] = mems[s.streams['t']]

def create_trainer():
	masked_dec = dec*C.ops.clip(C.ops.argmax(y), 0, 1)
	loss, label_error = criterion(masked_dec, y)
	loss *= C.ops.clip(C.ops.argmax(y), 0, 1)

	lr_schedule = C.learning_parameter_schedule_per_sample([1e-3]*2 + [5e-4]*2 + [1e-4], epoch_size=int(epoch_size))
	momentum_as_time_constant = C.momentum_as_time_constant_schedule(1000)
	learner = C.adam(parameters=dec.parameters,
						 lr=lr_schedule,
						 momentum=momentum_as_time_constant,
						 gradient_clipping_threshold_per_sample=15, 
						 gradient_clipping_with_truncation=True)

	progress_printer = C.logging.ProgressPrinter(tag='Training', num_epochs=num_epochs)
	trainer = C.Trainer(dec, (loss, label_error), learner, progress_printer)
	C.logging.log_number_of_parameters(dec)
	return trainer

def create_reader(path, is_training):
	return C.io.MinibatchSource(C.io.CTFDeserializer(path, C.io.StreamDefs(
			source		= C.io.StreamDef(field='S0', shape=vocab_size, is_sparse=True), 
			slot_labels	= C.io.StreamDef(field='S1', shape=num_labels, is_sparse=True)
	)), randomize=is_training, max_sweeps = C.io.INFINITELY_REPEAT if is_training else 1)

def validate():
	valid_reader = create_reader(files['valid']['file'], is_training=False)
	while True:
		data = valid_reader.next_minibatch(minibatch_size, input_map={
				x: valid_reader.streams.source,
				y: valid_reader.streams.slot_labels
		})
		if not data:
			break
		enhance_data(data, enc)
		trainer.test_minibatch(data)
	trainer.summarize_test_progress()

def evaluate():
	test_reader = create_reader(files['test']['file'], is_training=False)
	while True:
		data = test_reader.next_minibatch(minibatch_size, input_map={
			x: test_reader.streams.source,
			y: test_reader.streams.slot_labels
		})
		if not data:
			break
		# Enhance data
		enhance_data(data, enc)
		# Test model
		trainer.test_minibatch(data)
	trainer.summarize_test_progress()

def train():
	train_reader = create_reader(files['train']['file'], is_training=True)
	step = 0
	pp = C.logging.ProgressPrinter(freq=10, tag='Training')
	for epoch in range(num_epochs):
		epoch_end = (epoch+1) * epoch_size
		while step < epoch_end:
			data = train_reader.next_minibatch(minibatch_size, input_map={
				x: train_reader.streams.source,
				y: train_reader.streams.slot_labels
			})
			# Enhance data
			enhance_data(data, enc)
			# Train model
			trainer.train_minibatch(data)
			pp.update_with_trainer(trainer, with_metric=True)
			step += data[y].num_samples
		pp.epoch_summary(with_metric=True)
		trainer.save_checkpoint("models/model-" + str(epoch + 1) + ".cntk")
		validate()
		evaluate()

model = create_model()
enc, dec = model(x, t)
trainer = create_trainer()
train()
